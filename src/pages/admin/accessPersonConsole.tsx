import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Copy,
  FileClock,
  Globe2,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import {
  fetchAccessInviteDeliveries,
  sendAccessInvite,
  validateAccessInvitePreflight,
  type AccessInviteDelivery,
  type AccessInviteType,
} from '@/lib/accessInvites';
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
  adminGrantTechnicianAccess,
  adminRenewTechnicianAccess,
  adminRevokeTechnicianAccess,
  adminUpdateTechnicianMachines,
  fetchAdminTechnicianAccessContext,
  type AdminTechnicianAccessContext,
  type AdminTechnicianAccount,
  type AdminTechnicianGrant,
  type AdminTechnicianMachine,
} from '@/lib/adminTechnicianAccess';
import {
  fetchAdminCorporatePartnerAccessOptions,
  fetchAdminEffectiveAccessContext,
  grantCorporatePartnerMembership,
  revokeCorporatePartnerMembership,
  setPartnershipPartyPortalAccess,
  type CorporatePartnerOption,
  type CorporatePartnerPartnership,
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
import {
  upsertReportingPartnerAdmin,
  type ReportingPartner,
} from '@/lib/partnershipReporting';
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
  memberEmail: string | null;
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

type AccessLauncherPreset =
  | 'corporate_partner'
  | 'technician'
  | 'scoped_admin'
  | 'super_admin'
  | 'plus_customer';

type AccessLauncherInitialState = {
  open?: boolean;
  preset?: string;
  email?: string;
  partnerId?: string;
  accountId?: string;
};

type AdminPersonAccessConsoleProps = {
  initialShowActivity?: boolean;
  initialLauncher?: AccessLauncherInitialState;
};

type AccessLauncherPresetMeta = {
  key: AccessLauncherPreset;
  label: string;
  description: string;
  inviteable: boolean;
};

type CorporatePartnerInviteOutcome = 'sent' | 'failed' | 'not_attempted';
type CorporatePartnerPortalAccessOutcome = 'not_staged' | 'applied' | 'held_back' | 'partially_applied';

type CorporatePartnerSaveConfirmation = {
  partnerName: string;
  targetEmail: string;
  portalEnabledPartnershipCount: number;
  derivedMachineCount: number;
  stagedPortalPartnershipCount: number;
  portalAccessOutcome: CorporatePartnerPortalAccessOutcome;
  portalAccessMessage: string;
  activePersonGrant: boolean;
  inviteOutcome: CorporatePartnerInviteOutcome;
  inviteMessage: string;
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
const emptyTechnicianAccessContext: AdminTechnicianAccessContext = {
  targetEmail: '',
  targetUserId: null,
  activeAccountCount: 0,
  eligibleAccountCount: 0,
  ineligibleAccountCount: 0,
  accounts: [],
  grants: [],
};
const emptyReportingAccessMatrix: AdminReportingAccessMatrix = { people: [], machines: [], grants: [] };
const emptyScopedAdminGrants: ScopedAdminGrantRecord[] = [];
const emptyAdminRoles: AdminRoleRecord[] = [];
const emptyMachineInventory: CustomerMachineInventoryRecord[] = [];
const emptyAuditLog: AdminAuditLogRecord[] = [];
const trainingOnlyScopeValue = '__training_only__';
const emptyPartnerForm = {
  name: '',
  legalName: '',
  primaryContactName: '',
  primaryContactEmail: '',
  notes: '',
};
const accessLauncherPresets: AccessLauncherPresetMeta[] = [
  {
    key: 'corporate_partner',
    label: 'Corporate Partner',
    description: 'Invite by email, connect to a partner record, and enable partner-facing portal access.',
    inviteable: true,
  },
  {
    key: 'technician',
    label: 'Technician',
    description: 'Invite by email for training-only access or one assigned reporting machine.',
    inviteable: true,
  },
  {
    key: 'scoped_admin',
    label: 'Scoped Admin',
    description: 'Existing auth user required; grant limited admin reporting access by machine.',
    inviteable: false,
  },
  {
    key: 'super_admin',
    label: 'Super Admin',
    description: 'Existing auth user required; high-risk global admin role.',
    inviteable: false,
  },
  {
    key: 'plus_customer',
    label: 'Plus Customer',
    description: 'Existing customer account oriented; open the person workspace to manage Plus grants.',
    inviteable: false,
  },
];
const accessLauncherPresetKeys = new Set(accessLauncherPresets.map((preset) => preset.key));

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
const normalizeLauncherPreset = (value: string | undefined): AccessLauncherPreset | undefined =>
  value && accessLauncherPresetKeys.has(value as AccessLauncherPreset)
    ? (value as AccessLauncherPreset)
    : undefined;
const uniqueValues = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));
const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;
const getCorporatePartnerMachineIds = (partnerships: CorporatePartnerPartnership[]) =>
  new Set(
    partnerships.flatMap((partnership) =>
      partnership.machines.map((machine) => machine.machineId).filter(Boolean)
    )
  );
const getCorporatePartnerInviteEmail = (
  membership: CorporatePartnerSourceRecord,
  identity: AccessWorkspaceIdentity
) => normalizeSearch(membership.memberEmail ?? identity.email ?? '');
const getLatestInviteDeliveryBySourceId = (deliveries: AccessInviteDelivery[]) => {
  const latestBySourceId = new Map<string, AccessInviteDelivery>();
  deliveries.forEach((delivery) => {
    if (!latestBySourceId.has(delivery.sourceId)) {
      latestBySourceId.set(delivery.sourceId, delivery);
    }
  });
  return latestBySourceId;
};
const formatInviteDeliverySummary = (delivery: AccessInviteDelivery | undefined) => {
  if (!delivery) return 'No invite email has been sent from this membership yet.';
  const sentAt = formatDate(delivery.sentAt);
  return delivery.deliveryStatus === 'sent'
    ? `Last invite sent ${sentAt} to ${delivery.targetEmail}.`
    : `Last invite failed ${sentAt}${delivery.errorMessage ? `: ${delivery.errorMessage}` : '.'}`;
};
const isPortalAccessOutcomeWarning = (outcome: CorporatePartnerPortalAccessOutcome) =>
  outcome === 'held_back' || outcome === 'partially_applied';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asBoolean = (value: unknown) => Boolean(value);
const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : [];

const matchesIdentityEmail = (identity: AccessWorkspaceIdentity, email: string | null | undefined) =>
  Boolean(identity.email && email && normalizeSearch(identity.email) === normalizeSearch(email));

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
      memberEmail: asNullableString(record.memberEmail),
      status: asString(record.status, 'active'),
      startsAt: asNullableString(record.startsAt),
      expiresAt: asNullableString(record.expiresAt),
      grantReason: asString(record.grantReason, 'Corporate Partner access'),
      revokedAt: asNullableString(record.revokedAt),
      isActive: asBoolean(record.isActive),
    }))
    .filter((record) => record.id);

const getCorporateMembershipsForIdentity = (
  context: EffectiveAccessContext | null,
  partners: CorporatePartnerOption[],
  identity: AccessWorkspaceIdentity
): CorporatePartnerSourceRecord[] => {
  const membershipsById = new Map<string, CorporatePartnerSourceRecord>();

  getCorporateSources(context).forEach((membership) => {
    membershipsById.set(membership.id, membership);
  });

  partners.forEach((partner) => {
    partner.memberships
      .filter(
        (membership) =>
          (identity.userId && membership.userId === identity.userId) ||
          matchesIdentityEmail(identity, membership.memberEmail)
      )
      .forEach((membership) => {
        const existing = membershipsById.get(membership.id);
        membershipsById.set(membership.id, {
          id: membership.id,
          partnerId: partner.partnerId,
          partnerName: partner.partnerName,
          memberEmail: membership.memberEmail || existing?.memberEmail || null,
          status: membership.status,
          startsAt: membership.startsAt,
          expiresAt: membership.expiresAt,
          grantReason: membership.grantReason || existing?.grantReason || 'Corporate Partner access',
          revokedAt: membership.revokedAt,
          isActive: membership.isActive,
        });
      });
  });

  return [...membershipsById.values()].sort((a, b) => Number(b.isActive) - Number(a.isActive));
};

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

const getGrantMachineScopeValue = (grant: AdminTechnicianGrant) =>
  grant.machines.find((machine) => machine.isActive)?.machineId ??
  grant.machines.find((machine) => !machine.revokedAt && machine.status === 'active')?.machineId ??
  trainingOnlyScopeValue;

const getMachineScopeId = (value: string) => (value === trainingOnlyScopeValue ? null : value);

const getAccountMachines = (
  accounts: AdminTechnicianAccount[],
  accountId: string
): AdminTechnicianMachine[] =>
  accounts.find((account) => account.accountId === accountId)?.machines ?? [];

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

const getManualReportingMachineIds = (context: EffectiveAccessContext | null) => {
  if (!context || context.presets.includes('Super Admin')) return [];

  const derivedMachineIds = new Set([
    ...(context.scopes.corporatePartnerMachineIds ?? []),
    ...(context.scopes.technicianMachineIds ?? []),
    ...(context.scopes.scopedAdminMachineIds ?? []),
  ]);

  return (context.scopes.machineIds ?? []).filter((machineId) => !derivedMachineIds.has(machineId));
};

const getSoonestFutureDate = (values: Array<string | null | undefined>) => {
  const now = Date.now();
  const futureDates = values
    .map((value) => (value ? new Date(value) : null))
    .filter((date): date is Date => Boolean(date) && Number.isFinite(date.getTime()) && date.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime());

  return futureDates[0]?.toISOString() ?? null;
};

const formatReportingAccessLevel = (level: ReportingAccessLevel) =>
  level === 'report_manager' ? 'Report manager' : 'Viewer';

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

export function AdminPersonAccessConsole(props: AdminPersonAccessConsoleProps) {
  const { isSuperAdmin } = useAuth();

  if (!isSuperAdmin) {
    return <AdminPersonAccessConsoleBoundary />;
  }

  return <AdminPersonAccessConsoleInner {...props} />;
}

function AdminPersonAccessConsoleBoundary() {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold text-foreground">Super Admin access is required for global access management.</h2>
          <p className="mt-1">
            Scoped admins can manage manual reporting grants only through the assigned-machine
            reporting workspace.
          </p>
        </div>
      </div>
    </div>
  );
}

function AdminPersonAccessConsoleInner({
  initialShowActivity = false,
  initialLauncher,
}: AdminPersonAccessConsoleProps) {
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<SelectedAccessPerson | null>(null);
  const [showActivity, setShowActivity] = useState(initialShowActivity);
  const [isAccessLauncherOpen, setIsAccessLauncherOpen] = useState(Boolean(initialLauncher?.open));
  const normalizedSubmittedSearch = submittedSearch.trim();
  const submittedSearchIsEmail = hasEmailShape(normalizedSubmittedSearch);

  useEffect(() => {
    if (initialLauncher?.open) {
      setIsAccessLauncherOpen(true);
    }
  }, [
    initialLauncher?.accountId,
    initialLauncher?.email,
    initialLauncher?.open,
    initialLauncher?.partnerId,
    initialLauncher?.preset,
  ]);

  const {
    data: searchResults = emptyAccountSummaries,
    isFetching: isSearching,
    error: searchError,
  } = useQuery({
    queryKey: ['admin-person-access-search', submittedSearch],
    queryFn: () => fetchAdminAccountSummaries(submittedSearch),
    enabled: normalizedSubmittedSearch.length > 0,
    staleTime: 1000 * 30,
  });

  const accountSearchKey = selectedPerson?.userId ?? selectedPerson?.email ?? '';
  const {
    data: selectedAccountResults = emptyAccountSummaries,
    isFetching: isLoadingSelectedAccount,
    error: selectedAccountError,
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

  const identity = useMemo(
    () => (selectedPerson ? buildIdentity(selectedPerson, selectedAccount, effectiveAccess) : null),
    [effectiveAccess, selectedAccount, selectedPerson]
  );

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
      queryClient.invalidateQueries({ queryKey: ['admin-technician-access-context'] }),
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

  const handlePreviewEmail = (value: string) => {
    if (!hasEmailShape(value)) {
      toast.error('Enter a valid email to open an email-based access workspace.');
      return;
    }
    setSelectedPerson({ email: value, userId: null, label: value });
  };

  const searchFailed = Boolean(searchError);
  const canShowSearchResults = normalizedSubmittedSearch.length > 0 && !isSearching && !searchFailed;
  const searchErrorMessage = getErrorMessage(searchError, 'Unable to search people.');
  const selectedAccountErrorMessage = getErrorMessage(
    selectedAccountError,
    'Unable to refresh the selected account summary.'
  );

  return (
    <div className="space-y-6">
      <AccessLauncher
        open={isAccessLauncherOpen}
        onOpenChange={setIsAccessLauncherOpen}
        initialPreset={initialLauncher?.preset}
        initialEmail={initialLauncher?.email}
        initialPartnerId={initialLauncher?.partnerId}
        initialAccountId={initialLauncher?.accountId}
        onOpenWorkspace={(person) => setSelectedPerson(person)}
        onChanged={refreshWorkspace}
      />

      <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[0.55fr_0.45fr] lg:items-end">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Find a person</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Search by email or user ID, then manage that person's effective access from one
              workspace.
            </p>
          </div>
          <div className="min-w-0 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search by email or user ID"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearchSubmit();
                }}
                placeholder="name@example.com or user ID"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button onClick={handleSearchSubmit} disabled={isSearching}>
                {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Search
              </Button>
              <Button onClick={() => setIsAccessLauncherOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add or invite access
              </Button>
              {!selectedPerson && (
                <Button variant="outline" onClick={() => setShowActivity((current) => !current)}>
                  <FileClock className="mr-2 h-4 w-4" />
                  Activity
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {!submittedSearch && !selectedPerson && (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
              Start with a person. Source-specific tools appear only after a person is selected, so
              grant type names do not drive the workflow.
            </div>
          )}

          {normalizedSubmittedSearch && isSearching && (
            <div className="rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
              Searching people...
            </div>
          )}

          {normalizedSubmittedSearch && !isSearching && searchFailed && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 md:col-span-2 xl:col-span-3">
              <p className="text-sm font-medium text-destructive">Unable to search people.</p>
              <p className="mt-1 break-words text-sm text-destructive/90">{searchErrorMessage}</p>
            </div>
          )}

          {canShowSearchResults && searchResults.length === 0 && (
            <div className="rounded-md border border-border bg-muted/20 p-4 md:col-span-2 xl:col-span-3">
              <p className="text-sm font-medium text-foreground">No matching auth user was found.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {submittedSearchIsEmail
                  ? 'Email-based Corporate Partner grants can still be created before first sign-in.'
                  : 'Try a full email address or Supabase Auth user ID.'}
              </p>
              {submittedSearchIsEmail && (
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => handlePreviewEmail(normalizedSubmittedSearch)}
                >
                  Open email workspace
                </Button>
              )}
            </div>
          )}

          {canShowSearchResults && searchResults.slice(0, 9).map((account) => (
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

          {canShowSearchResults && submittedSearchIsEmail && searchResults.length > 0 && (
            <button
              type="button"
              onClick={() => handlePreviewEmail(normalizedSubmittedSearch)}
              className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-left transition hover:bg-muted/40"
            >
              <p className="text-sm font-medium text-foreground">Use typed email instead</p>
              <p className="mt-1 break-all text-sm text-muted-foreground">{normalizedSubmittedSearch}</p>
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
              {getErrorMessage(effectiveAccessError, 'Unable to load the effective access preview.')}
            </div>
          )}

          {selectedAccountError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {selectedAccountErrorMessage}
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
              <TechnicianAccessCard
                identity={identity}
                effectiveAccess={effectiveAccess}
                onChanged={refreshWorkspace}
              />
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

function AccessLauncher({
  open,
  onOpenChange,
  initialPreset,
  initialEmail,
  initialPartnerId,
  initialAccountId,
  onOpenWorkspace,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPreset?: string;
  initialEmail?: string;
  initialPartnerId?: string;
  initialAccountId?: string;
  onOpenWorkspace: (person: SelectedAccessPerson) => void;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const initialNormalizedPreset = normalizeLauncherPreset(initialPreset) ?? 'corporate_partner';
  const [preset, setPreset] = useState<AccessLauncherPreset>(initialNormalizedPreset);
  const [targetInput, setTargetInput] = useState(initialEmail ?? '');
  const [selectedExistingUserId, setSelectedExistingUserId] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState(initialPartnerId ?? '');
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId ?? '');
  const [selectedScopeValue, setSelectedScopeValue] = useState(trainingOnlyScopeValue);
  const [grantReason, setGrantReason] = useState('');
  const [partnerForm, setPartnerForm] = useState(emptyPartnerForm);
  const [stagedPortalAccess, setStagedPortalAccess] = useState<Record<string, boolean>>({});
  const [corporatePartnerSaveConfirmation, setCorporatePartnerSaveConfirmation] =
    useState<CorporatePartnerSaveConfirmation | null>(null);
  const [isCreatingPartner, setIsCreatingPartner] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const searchValue = targetInput.trim();
  const normalizedEmail = hasEmailShape(searchValue) ? normalizeSearch(searchValue) : '';
  const presetMeta = accessLauncherPresets.find((item) => item.key === preset) ?? accessLauncherPresets[0];

  useEffect(() => {
    if (!open) return;
    setPreset(normalizeLauncherPreset(initialPreset) ?? 'corporate_partner');
    setTargetInput(initialEmail ?? '');
    setSelectedPartnerId(initialPartnerId ?? '');
    setSelectedAccountId(initialAccountId ?? '');
    setSelectedScopeValue(trainingOnlyScopeValue);
    setGrantReason('');
    setPartnerForm(emptyPartnerForm);
    setStagedPortalAccess({});
    setCorporatePartnerSaveConfirmation(null);
    setSelectedExistingUserId('');
  }, [initialAccountId, initialEmail, initialPartnerId, initialPreset, open]);

  const {
    data: existingPeople = emptyAccountSummaries,
    isFetching: isSearchingPeople,
    error: personSearchError,
  } = useQuery({
    queryKey: ['access-launcher-person-search', searchValue],
    queryFn: () => fetchAdminAccountSummaries(searchValue),
    enabled: open && searchValue.length >= 3,
    staleTime: 1000 * 30,
  });

  const {
    data: corporateOptions = emptyCorporatePartnerOptions,
    isFetching: isFetchingCorporateOptions,
    error: corporateOptionsError,
  } = useQuery({
    queryKey: ['admin-corporate-partner-access-options'],
    queryFn: fetchAdminCorporatePartnerAccessOptions,
    enabled: open && preset === 'corporate_partner',
    staleTime: 1000 * 30,
  });

  const {
    data: technicianContext = emptyTechnicianAccessContext,
    isFetching: isFetchingTechnicianContext,
    error: technicianContextError,
  } = useQuery({
    queryKey: ['admin-technician-access-context', normalizedEmail],
    queryFn: () => fetchAdminTechnicianAccessContext(normalizedEmail),
    enabled: open && preset === 'technician' && Boolean(normalizedEmail),
    staleTime: 1000 * 20,
  });

  const selectedExistingAccount = useMemo(() => {
    if (selectedExistingUserId) {
      return existingPeople.find((account) => account.user_id === selectedExistingUserId) ?? null;
    }

    const exactByUserId = existingPeople.find((account) => account.user_id === searchValue);
    if (exactByUserId) return exactByUserId;

    if (normalizedEmail) {
      return (
        existingPeople.find(
          (account) =>
            account.customer_email &&
            normalizeSearch(account.customer_email) === normalizedEmail
        ) ?? null
      );
    }

    return existingPeople.length === 1 ? existingPeople[0] : null;
  }, [existingPeople, normalizedEmail, searchValue, selectedExistingUserId]);

  useEffect(() => {
    if (selectedExistingUserId && existingPeople.some((account) => account.user_id === selectedExistingUserId)) {
      return;
    }

    const exactAccount =
      existingPeople.find((account) => account.user_id === searchValue) ??
      (normalizedEmail
        ? existingPeople.find(
            (account) =>
              account.customer_email &&
              normalizeSearch(account.customer_email) === normalizedEmail
          )
        : null);

    setSelectedExistingUserId(exactAccount?.user_id ?? '');
  }, [existingPeople, normalizedEmail, searchValue, selectedExistingUserId]);

  useEffect(() => {
    if (preset !== 'corporate_partner') return;
    if (selectedPartnerId && corporateOptions.partners.some((partner) => partner.partnerId === selectedPartnerId)) {
      return;
    }
    setSelectedPartnerId(initialPartnerId ?? corporateOptions.partners[0]?.partnerId ?? '');
  }, [corporateOptions.partners, initialPartnerId, preset, selectedPartnerId]);

  useEffect(() => {
    setStagedPortalAccess({});
    setCorporatePartnerSaveConfirmation(null);
  }, [normalizedEmail, preset, selectedPartnerId]);

  useEffect(() => {
    if (preset !== 'technician') return;
    if (selectedAccountId && technicianContext.accounts.some((account) => account.accountId === selectedAccountId)) {
      return;
    }
    setSelectedAccountId(initialAccountId ?? technicianContext.accounts[0]?.accountId ?? '');
  }, [initialAccountId, preset, selectedAccountId, technicianContext.accounts]);

  const selectedPartner =
    corporateOptions.partners.find((partner) => partner.partnerId === selectedPartnerId) ??
    corporateOptions.partners[0] ??
    null;
  const portalEnabledPartnerships =
    selectedPartner?.portalPartnerships.filter((partnership) => partnership.portalAccessEnabled) ?? [];
  const portalDisabledMachineBackedPartnerships =
    selectedPartner?.portalPartnerships.filter(
      (partnership) => !partnership.portalAccessEnabled && partnership.machines.length > 0
    ) ?? [];
  const stagedPortalPartnerships = portalDisabledMachineBackedPartnerships.filter(
    (partnership) => stagedPortalAccess[partnership.partyId]
  );
  const effectivePortalEnabledPartnerships = [
    ...portalEnabledPartnerships,
    ...stagedPortalPartnerships,
  ];
  const derivedMachineIds = getCorporatePartnerMachineIds(portalEnabledPartnerships);
  const effectiveDerivedMachineIds = getCorporatePartnerMachineIds(effectivePortalEnabledPartnerships);
  const allLinkedMachineIds = getCorporatePartnerMachineIds(selectedPartner?.portalPartnerships ?? []);
  const hasActiveLinkedPartnership = Boolean(selectedPartner && selectedPartner.portalPartnerships.length > 0);
  const hasActiveMachines = allLinkedMachineIds.size > 0;
  const corporatePartnerWillHavePortalScope =
    effectivePortalEnabledPartnerships.length > 0 && effectiveDerivedMachineIds.size > 0;
  const corporatePartnerReadiness = (() => {
    if (isFetchingCorporateOptions) {
      return {
        label: 'Checking partner setup',
        description: 'Loading active partnerships, portal access, and machines for this partner.',
      };
    }
    if (!selectedPartner) {
      return {
        label: 'No partner selected',
        description: 'Select or create the business partner before granting Corporate Partner access.',
      };
    }
    if (!hasActiveLinkedPartnership) {
      return {
        label: 'No active linked partnership',
        description:
          'This partner record is active, but no active reporting partnership is linked to it yet.',
      };
    }
    if (!hasActiveMachines) {
      return {
        label: 'No active machines',
        description:
          'The linked partnership needs at least one active reporting machine before partner reporting can be invited.',
      };
    }
    if (!corporatePartnerWillHavePortalScope) {
      return {
        label: 'Portal access not enabled',
        description:
          'Active machines exist, but Corporate Partner portal access is off. Stage portal access below to enable it with this same reason.',
      };
    }
    if (!normalizedEmail) {
      return {
        label: 'No invite email',
        description: 'Enter a valid email address for the person receiving access.',
      };
    }
    if (!grantReason.trim()) {
      return {
        label: 'Grant reason needed',
        description: 'Enter the audit reason that explains both the access grant and any staged portal change.',
      };
    }
    return {
      label: 'Person grant ready',
      description:
        stagedPortalPartnerships.length > 0
          ? `Save will grant the person, send the invite, then enable portal access for ${pluralize(stagedPortalPartnerships.length, 'partnership')}.`
          : 'Save will grant this person Corporate Partner access and send the invite.',
    };
  })();
  const selectedTechnicianAccount =
    technicianContext.accounts.find((account) => account.accountId === selectedAccountId) ??
    technicianContext.accounts[0] ??
    null;
  const selectedTechnicianMachines = useMemo(
    () => selectedTechnicianAccount?.machines ?? [],
    [selectedTechnicianAccount]
  );
  useEffect(() => {
    if (preset !== 'technician' || selectedScopeValue === trainingOnlyScopeValue) return;
    if (!selectedTechnicianMachines.some((machine) => machine.machineId === selectedScopeValue)) {
      setSelectedScopeValue(trainingOnlyScopeValue);
    }
  }, [preset, selectedScopeValue, selectedTechnicianMachines]);

  const selectedMachineId = getMachineScopeId(selectedScopeValue);
  const selectedTechnicianMachine =
    selectedMachineId &&
    selectedTechnicianMachines.find((machine) => machine.machineId === selectedMachineId);
  const hasTechnicianAccountEligibilityGap =
    preset === 'technician' &&
    Boolean(normalizedEmail) &&
    !isFetchingTechnicianContext &&
    !technicianContextError &&
    technicianContext.accounts.length === 0;
  const isExistingUserPreset = !presetMeta.inviteable;
  const canSaveInvite = presetMeta.inviteable && Boolean(normalizedEmail) && Boolean(grantReason.trim());
  const existingPresetActionLabel =
    preset === 'plus_customer' ? 'Open Plus Customer workspace' : 'Open person workspace';

  const refreshLauncherQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-corporate-partner-access-options'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-technician-access-context'] }),
      queryClient.invalidateQueries({ queryKey: ['access-launcher-person-search'] }),
    ]);
  };

  const openSelectedWorkspace = () => {
    if (!selectedExistingAccount) {
      toast.error(`${presetMeta.label} requires an existing authenticated user.`);
      return;
    }

    onOpenWorkspace({
      email: selectedExistingAccount.customer_email,
      userId: selectedExistingAccount.user_id,
      label: selectedExistingAccount.customer_email ?? selectedExistingAccount.user_id,
    });
    onOpenChange(false);
  };

  const createPartnerRecord = async () => {
    const partnerName = partnerForm.name.trim();
    const contactEmail = partnerForm.primaryContactEmail.trim() || normalizedEmail;

    if (!partnerName) {
      toast.error('Partner name is required.');
      return;
    }
    if (contactEmail && !hasEmailShape(contactEmail)) {
      toast.error('Primary contact email must be valid.');
      return;
    }

    setIsCreatingPartner(true);
    try {
      const createdPartner: ReportingPartner = await upsertReportingPartnerAdmin({
        name: partnerName,
        legalName: partnerForm.legalName.trim() || null,
        partnerType: 'revenue_share_partner',
        primaryContactName: partnerForm.primaryContactName.trim() || null,
        primaryContactEmail: contactEmail || null,
        status: 'active',
        notes: partnerForm.notes.trim() || null,
        reason: 'Partner record created from Access Launcher',
      });
      setSelectedPartnerId(createdPartner.id);
      setPartnerForm(emptyPartnerForm);
      await queryClient.invalidateQueries({ queryKey: ['admin-corporate-partner-access-options'] });
      toast.success('Partner record created.');
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : 'Unable to create partner record.');
    } finally {
      setIsCreatingPartner(false);
    }
  };

  const saveInviteableAccess = async () => {
    const inviteType: AccessInviteType | null =
      preset === 'corporate_partner' ? 'corporate_partner' : preset === 'technician' ? 'technician' : null;
    if (!inviteType) {
      toast.error('Choose an inviteable access type.');
      return;
    }
    const invitePreflight = validateAccessInvitePreflight(inviteType, searchValue);
    if (!invitePreflight.ok) {
      toast.error(invitePreflight.message);
      return;
    }
    const grantReasonText = grantReason.trim();
    if (!grantReasonText) {
      toast.error('Grant reason is required.');
      return;
    }

    setIsSaving(true);
    try {
      let inviteDeliveryFailed = false;

      if (preset === 'corporate_partner') {
        if (!selectedPartner) {
          toast.error('Select or create a partner record.');
          return;
        }
        if (!corporatePartnerWillHavePortalScope) {
          toast.error(
            'Stage portal access for a machine-backed partnership before sending this Corporate Partner invite.'
          );
          return;
        }

        const membership = await grantCorporatePartnerMembership({
          email: invitePreflight.targetEmail,
          partnerId: selectedPartner.partnerId,
          reason: grantReasonText,
        });

        if (!membership.id) {
          throw new Error('Corporate Partner membership was saved without a source ID.');
        }

        let inviteOutcome: CorporatePartnerInviteOutcome = 'not_attempted';
        let inviteMessage = 'Invite email was not attempted.';

        try {
          await sendAccessInvite({
            inviteType: 'corporate_partner',
            sourceId: membership.id,
            targetEmail: invitePreflight.targetEmail,
            loginUrl: invitePreflight.loginUrl,
          });
          inviteOutcome = 'sent';
          inviteMessage = `Invite email sent to ${invitePreflight.targetEmail}.`;
        } catch (inviteError) {
          inviteDeliveryFailed = true;
          inviteOutcome = 'failed';
          inviteMessage =
            inviteError instanceof Error
              ? `Invite email failed: ${inviteError.message}`
              : 'Invite email failed.';
          toast.error(
            inviteError instanceof Error
              ? `Corporate Partner membership saved, but invite email failed: ${inviteError.message}. Staged portal access was not applied.`
              : 'Corporate Partner membership saved, but invite email failed. Staged portal access was not applied.'
          );
        }

        if (inviteDeliveryFailed) {
          setCorporatePartnerSaveConfirmation({
            partnerName: selectedPartner.partnerName,
            targetEmail: invitePreflight.targetEmail,
            portalEnabledPartnershipCount: portalEnabledPartnerships.length,
            derivedMachineCount: derivedMachineIds.size,
            stagedPortalPartnershipCount: stagedPortalPartnerships.length,
            portalAccessOutcome: stagedPortalPartnerships.length > 0 ? 'held_back' : 'not_staged',
            portalAccessMessage:
              stagedPortalPartnerships.length > 0
                ? `Staged partner-level portal access was held back; ${pluralize(stagedPortalPartnerships.length, 'partnership')} remain unapplied. Use invite recovery on the active membership, then save portal access separately or retry this launcher.`
                : 'No staged partner-level portal access changes were requested.',
            activePersonGrant: membership.status === 'active',
            inviteOutcome,
            inviteMessage,
          });
          await refreshLauncherQueries();
          await onChanged();
          return;
        }

        let portalAccessOutcome: CorporatePartnerPortalAccessOutcome = 'not_staged';
        let portalAccessMessage = 'No staged partner-level portal access changes were requested.';
        let appliedPortalPartnershipCount = 0;

        if (stagedPortalPartnerships.length > 0) {
          try {
            for (const partnership of stagedPortalPartnerships) {
              await setPartnershipPartyPortalAccess({
                partyId: partnership.partyId,
                enabled: true,
                reason: grantReasonText,
              });
              appliedPortalPartnershipCount += 1;
            }
            portalAccessOutcome = 'applied';
            portalAccessMessage = `Partner-level portal access was applied for ${pluralize(stagedPortalPartnerships.length, 'staged partnership')}.`;
          } catch (portalError) {
            const portalErrorMessage = getErrorMessage(
              portalError,
              'Unable to apply staged partner-level portal access.'
            );
            const appliedPortalPartnerships = stagedPortalPartnerships.slice(0, appliedPortalPartnershipCount);
            setCorporatePartnerSaveConfirmation({
              partnerName: selectedPartner.partnerName,
              targetEmail: invitePreflight.targetEmail,
              portalEnabledPartnershipCount:
                portalEnabledPartnerships.length + appliedPortalPartnershipCount,
              derivedMachineCount: getCorporatePartnerMachineIds([
                ...portalEnabledPartnerships,
                ...appliedPortalPartnerships,
              ]).size,
              stagedPortalPartnershipCount: stagedPortalPartnerships.length,
              portalAccessOutcome:
                appliedPortalPartnershipCount > 0 ? 'partially_applied' : 'held_back',
              portalAccessMessage:
                appliedPortalPartnershipCount > 0
                  ? `Partner-level portal access was applied for ${appliedPortalPartnershipCount} of ${stagedPortalPartnerships.length} staged partnerships before an error: ${portalErrorMessage}`
                  : `Invite email sent, but staged partner-level portal access was held back: ${portalErrorMessage}`,
              activePersonGrant: membership.status === 'active',
              inviteOutcome,
              inviteMessage,
            });
            toast.error(
              appliedPortalPartnershipCount > 0
                ? `Invite sent, but partner-level portal access was only partially applied: ${portalErrorMessage}`
                : `Invite sent, but staged partner-level portal access was not applied: ${portalErrorMessage}`
            );
            await refreshLauncherQueries();
            await onChanged();
            return;
          }
        }

        setCorporatePartnerSaveConfirmation({
          partnerName: selectedPartner.partnerName,
          targetEmail: invitePreflight.targetEmail,
          portalEnabledPartnershipCount: effectivePortalEnabledPartnerships.length,
          derivedMachineCount: effectiveDerivedMachineIds.size,
          stagedPortalPartnershipCount: stagedPortalPartnerships.length,
          portalAccessOutcome,
          portalAccessMessage,
          activePersonGrant: membership.status === 'active',
          inviteOutcome,
          inviteMessage,
        });

        toast.success(
          stagedPortalPartnerships.length > 0
            ? 'Corporate Partner access saved, invite email sent, and staged portal access applied.'
            : 'Corporate Partner access saved and invite email sent.'
        );

        trackEvent('admin_access_launcher_saved', {
          preset,
          inviteable: presetMeta.inviteable,
          stagedPortalPartnerships: stagedPortalPartnerships.length,
        });
        setGrantReason('');
        setStagedPortalAccess({});
        await refreshLauncherQueries();
        await onChanged();
        return;
      }

      if (preset === 'technician') {
        if (!selectedTechnicianAccount) {
          toast.error('Select a sponsor account.');
          return;
        }

        const grant = await adminGrantTechnicianAccess({
          email: invitePreflight.targetEmail,
          accountId: selectedTechnicianAccount.accountId,
          machineId: selectedMachineId,
          reason: grantReasonText,
        });

        if (!grant.grantId) {
          throw new Error('Technician access was saved without a grant ID.');
        }

        try {
          await sendAccessInvite({
            inviteType: 'technician',
            sourceId: grant.grantId,
            targetEmail: invitePreflight.targetEmail,
            loginUrl: invitePreflight.loginUrl,
          });
          toast.success('Technician access saved and invite email sent.');
        } catch (inviteError) {
          inviteDeliveryFailed = true;
          toast.error(
            inviteError instanceof Error
              ? `Technician access saved, but invite email failed: ${inviteError.message}. Keep this dialog open and try again.`
              : 'Technician access saved, but invite email failed. Keep this dialog open and try again.'
          );
        }
      }

      if (inviteDeliveryFailed) {
        await refreshLauncherQueries();
        await onChanged();
        return;
      }

      trackEvent('admin_access_launcher_saved', {
        preset,
        inviteable: presetMeta.inviteable,
      });
      setGrantReason('');
      await refreshLauncherQueries();
      await onChanged();
      onOpenWorkspace({
        email: invitePreflight.targetEmail,
        userId: selectedExistingAccount?.user_id ?? null,
        label: invitePreflight.targetEmail,
      });
      onOpenChange(false);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save access.');
    } finally {
      setIsSaving(false);
    }
  };

  const corporatePartnerConfirmationNeedsAttention =
    corporatePartnerSaveConfirmation?.inviteOutcome === 'failed' ||
    (corporatePartnerSaveConfirmation
      ? isPortalAccessOutcomeWarning(corporatePartnerSaveConfirmation.portalAccessOutcome)
      : false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add or invite access</DialogTitle>
          <DialogDescription>
            Start with a person or email, choose the intended outcome, then save the access source
            with the right scope and audit reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="rounded-md border border-border bg-muted/20 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.4fr)] lg:items-end">
              <div>
                <Label htmlFor="access-launcher-target">Person or email</Label>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="access-launcher-target"
                    value={targetInput}
                    onChange={(event) => setTargetInput(event.target.value)}
                    placeholder="partner@example.com or existing user ID"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="rounded-md border border-border bg-background p-3 text-sm">
                <p className="font-medium text-foreground">
                  {normalizedEmail ? normalizedEmail : 'Existing-user lookup'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {presetMeta.inviteable
                    ? 'This preset can be granted before first sign-in.'
                    : 'This preset requires an existing Supabase Auth user.'}
                </p>
              </div>
            </div>

            {searchValue.length >= 3 && (
              <div className="mt-3 rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Matching auth users</p>
                  {isSearchingPeople && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {personSearchError ? (
                  <p className="mt-2 text-sm text-destructive">
                    {getErrorMessage(personSearchError, 'Unable to search people.')}
                  </p>
                ) : existingPeople.length === 0 && !isSearchingPeople ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No auth user found. Corporate Partner and Technician invites can still be sent
                    to a valid email.
                  </p>
                ) : (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {existingPeople.slice(0, 4).map((account) => (
                      <button
                        key={account.user_id}
                        type="button"
                        onClick={() => {
                          setSelectedExistingUserId(account.user_id);
                          if (account.customer_email) setTargetInput(account.customer_email);
                        }}
                        className={cn(
                          'min-w-0 rounded-md border border-border bg-background p-3 text-left transition hover:bg-muted/30',
                          selectedExistingAccount?.user_id === account.user_id && 'border-primary bg-primary/5'
                        )}
                      >
                        <p className="truncate text-sm font-medium text-foreground">
                          {account.customer_email ?? 'No email on file'}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">{account.user_id}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" role="radiogroup" aria-label="Access preset">
              {accessLauncherPresets.map((item) => {
                const isSelected = item.key === preset;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-checked={isSelected}
                    role="radio"
                    onClick={() => setPreset(item.key)}
                    className={cn(
                      'rounded-md border p-3 text-left transition hover:bg-muted/30',
                      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-background'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{item.label}</p>
                      <Badge variant={item.inviteable ? 'default' : 'outline'}>
                        {item.inviteable ? 'Invite' : 'Existing'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {preset === 'corporate_partner' && (
            <section className="grid gap-4 lg:grid-cols-[0.42fr_0.58fr]">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="access-launcher-partner">Partner record</Label>
                  <select
                    id="access-launcher-partner"
                    value={selectedPartner?.partnerId ?? ''}
                    onChange={(event) => setSelectedPartnerId(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={isFetchingCorporateOptions || corporateOptions.partners.length === 0}
                  >
                    {corporateOptions.partners.length === 0 ? (
                      <option value="">No partner records</option>
                    ) : (
                      corporateOptions.partners.map((partner) => (
                        <option key={partner.partnerId} value={partner.partnerId}>
                          {partner.partnerName}
                        </option>
                      ))
                    )}
                  </select>
                  {corporateOptionsError && (
                    <p className="mt-1 text-xs text-destructive">
                      {getErrorMessage(corporateOptionsError, 'Unable to load partner records.')}
                    </p>
                  )}
                </div>

                <div className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Create partner record</p>
                  <div className="mt-3 grid gap-3">
                    <Input
                      value={partnerForm.name}
                      onChange={(event) => setPartnerForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Partner name"
                    />
                    <Input
                      value={partnerForm.legalName}
                      onChange={(event) => setPartnerForm((current) => ({ ...current, legalName: event.target.value }))}
                      placeholder="Legal name (optional)"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        value={partnerForm.primaryContactName}
                        onChange={(event) =>
                          setPartnerForm((current) => ({
                            ...current,
                            primaryContactName: event.target.value,
                          }))
                        }
                        placeholder="Primary contact"
                      />
                      <Input
                        value={partnerForm.primaryContactEmail}
                        onChange={(event) =>
                          setPartnerForm((current) => ({
                            ...current,
                            primaryContactEmail: event.target.value,
                          }))
                        }
                        placeholder={normalizedEmail || 'contact@example.com'}
                      />
                    </div>
                    <Textarea
                      value={partnerForm.notes}
                      onChange={(event) => setPartnerForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Notes (optional)"
                    />
                    <Button type="button" variant="outline" onClick={createPartnerRecord} disabled={isCreatingPartner}>
                      {isCreatingPartner ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                      Create and select partner
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {corporatePartnerSaveConfirmation && (
                  <div
                    className={cn(
                      'rounded-md border p-3',
                      corporatePartnerConfirmationNeedsAttention
                        ? 'border-amber/40 bg-amber/10'
                        : 'border-primary/30 bg-primary/5'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {corporatePartnerConfirmationNeedsAttention ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm font-semibold text-foreground">
                            {corporatePartnerConfirmationNeedsAttention ? 'Action needed' : 'Invite sent'}
                          </p>
                          <Badge
                            className="w-fit"
                            variant={corporatePartnerConfirmationNeedsAttention ? 'destructive' : 'default'}
                          >
                            {corporatePartnerConfirmationNeedsAttention ? 'Review' : 'Complete'}
                          </Badge>
                        </div>
                        <p className="mt-2 break-words text-sm text-muted-foreground">
                          {corporatePartnerSaveConfirmation.inviteMessage}
                        </p>
                        <ul className="mt-3 space-y-2 text-sm">
                          <li className="flex items-start gap-2">
                            {corporatePartnerSaveConfirmation.activePersonGrant ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                            )}
                            <span className="text-muted-foreground">
                              Person membership{' '}
                              {corporatePartnerSaveConfirmation.activePersonGrant
                                ? 'is active'
                                : 'was saved but is not active'}{' '}
                              for {corporatePartnerSaveConfirmation.targetEmail}.
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            {corporatePartnerSaveConfirmation.inviteOutcome === 'sent' ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                            )}
                            <span className="text-muted-foreground">
                              {corporatePartnerSaveConfirmation.inviteMessage}
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            {isPortalAccessOutcomeWarning(corporatePartnerSaveConfirmation.portalAccessOutcome) ? (
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                            ) : (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            )}
                            <span className="text-muted-foreground">
                              {corporatePartnerSaveConfirmation.portalAccessMessage}
                            </span>
                          </li>
                        </ul>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <SummaryMetric label="Partner selected" value={corporatePartnerSaveConfirmation.partnerName} />
                          <SummaryMetric
                            label="Portal-enabled after save"
                            value={String(corporatePartnerSaveConfirmation.portalEnabledPartnershipCount)}
                          />
                          <SummaryMetric
                            label="Staged portal changes"
                            value={
                              corporatePartnerSaveConfirmation.stagedPortalPartnershipCount > 0
                                ? `${corporatePartnerSaveConfirmation.stagedPortalPartnershipCount} ${corporatePartnerSaveConfirmation.portalAccessOutcome.replace('_', ' ')}`
                                : 'None'
                            }
                          />
                          <SummaryMetric
                            label="Derived machines"
                            value={String(corporatePartnerSaveConfirmation.derivedMachineCount)}
                          />
                          <SummaryMetric
                            label="Active person grant"
                            value={corporatePartnerSaveConfirmation.activePersonGrant ? 'Yes' : 'No'}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <SummaryMetric
                    label="Partner"
                    value={
                      isFetchingCorporateOptions
                        ? 'Loading...'
                        : selectedPartner?.partnerName ?? 'No partner selected'
                    }
                  />
                  <SummaryMetric
                    label="Portal enabled after success"
                    value={String(effectivePortalEnabledPartnerships.length)}
                  />
                  <SummaryMetric label="Machines after success" value={String(effectiveDerivedMachineIds.size)} />
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{corporatePartnerReadiness.label}</p>
                      <p className="mt-1 text-muted-foreground">{corporatePartnerReadiness.description}</p>
                    </div>
                    <Badge
                      className="w-fit"
                      variant={corporatePartnerWillHavePortalScope ? 'default' : 'outline'}
                    >
                      Readiness
                    </Badge>
                  </div>
                </div>
                <PreviewBox>
                  This will grant Corporate Partner access for{' '}
                  {selectedPartner?.partnerName ?? 'the selected partner'} and send an invite to{' '}
                  {normalizedEmail || 'the entered email'}. Reporting is derived only from active
                  portal-enabled partnerships.
                  {stagedPortalPartnerships.length > 0 ? (
                    <>
                      {' '}After the membership and invite email succeed, this save will enable
                      partner-level portal access for {pluralize(stagedPortalPartnerships.length, 'partnership')}{' '}
                      using the same reason. If the invite fails, that partner-level change stays
                      unapplied. Portal setup still does not grant this person access without the
                      membership.
                    </>
                  ) : null}
                </PreviewBox>
                {portalDisabledMachineBackedPartnerships.length > 0 && (
                  <div className="rounded-md border border-amber/40 bg-amber/10 p-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 text-amber" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Enable portal access on save</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          These active partnerships have machines but Corporate Partner portal access is
                          off. Check the partnership to stage that explicit partner-level change; it
                          applies only after the membership exists and the invite email sends.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 divide-y divide-border rounded-md border border-border bg-background">
                      {portalDisabledMachineBackedPartnerships.map((partnership) => (
                        <label key={partnership.partyId} className="flex cursor-pointer items-start gap-3 p-3">
                          <Checkbox
                            checked={stagedPortalAccess[partnership.partyId] === true}
                            disabled={isSaving}
                            onCheckedChange={(checked) =>
                              setStagedPortalAccess((current) => ({
                                ...current,
                                [partnership.partyId]: checked === true,
                              }))
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
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <SummaryMetric label="Portal enabled now" value={String(portalEnabledPartnerships.length)} />
                  <SummaryMetric label="Machines now" value={String(derivedMachineIds.size)} />
                  <SummaryMetric
                    label="Invite target"
                    value={normalizedEmail ? 'Email invite' : 'Needs email'}
                  />
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {!selectedPartner ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      Select or create a partner record to check Corporate Partner invite readiness.
                    </p>
                  ) : selectedPartner.portalPartnerships.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No active linked partnership is available for this partner record yet.
                    </p>
                  ) : (
                    selectedPartner.portalPartnerships.map((partnership) => {
                      const willEnable =
                        !partnership.portalAccessEnabled && stagedPortalAccess[partnership.partyId] === true;
                      const hasMachines = partnership.machines.length > 0;
                      return (
                        <div key={partnership.partyId} className="flex items-start justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {partnership.partnershipName}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {hasMachines
                                ? pluralize(partnership.machineCount, 'active machine')
                                : 'No active machines'}
                            </p>
                          </div>
                          <Badge
                            className="w-fit"
                            variant={partnership.portalAccessEnabled || willEnable ? 'default' : 'outline'}
                          >
                            {partnership.portalAccessEnabled
                              ? 'Portal enabled'
                              : willEnable
                                ? 'Staged after invite'
                                : hasMachines
                                  ? 'Portal off'
                                  : 'No active machines'}
                          </Badge>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          )}

          {preset === 'technician' && (
            <section className="grid gap-4 lg:grid-cols-[0.42fr_0.58fr]">
              <div className="space-y-3">
                <div>
                  <Label htmlFor="access-launcher-technician-account">Sponsor account</Label>
                  <select
                    id="access-launcher-technician-account"
                    value={selectedTechnicianAccount?.accountId ?? ''}
                    onChange={(event) => setSelectedAccountId(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={isFetchingTechnicianContext || technicianContext.accounts.length === 0}
                  >
                    {technicianContext.accounts.length === 0 ? (
                      <option value="">No eligible accounts</option>
                    ) : (
                      technicianContext.accounts.map((account) => (
                        <option key={account.accountId} value={account.accountId}>
                          {account.accountName}
                        </option>
                      ))
                    )}
                  </select>
                  {hasTechnicianAccountEligibilityGap && (
                    <div className="mt-2 rounded-md border border-amber/40 bg-amber/10 p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                        <p className="text-muted-foreground">
                          No active Plus Customer owner is available to sponsor Technician access.
                          Add or repair Plus Customer ownership first, then return to invite the
                          Technician.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="access-launcher-technician-machine">Machine scope</Label>
                  <select
                    id="access-launcher-technician-machine"
                    value={selectedScopeValue}
                    onChange={(event) => setSelectedScopeValue(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={!selectedTechnicianAccount}
                  >
                    <option value={trainingOnlyScopeValue}>Training only - no machine</option>
                    {selectedTechnicianMachines.map((machine) => (
                      <option key={machine.machineId} value={machine.machineId}>
                        {machine.machineLabel}
                      </option>
                    ))}
                  </select>
                  {technicianContextError && (
                    <p className="mt-1 text-xs text-destructive">
                      {getErrorMessage(technicianContextError, 'Unable to load eligible Technician accounts.')}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <SummaryMetric
                    label="Sponsor"
                    value={
                      hasTechnicianAccountEligibilityGap
                        ? 'No eligible sponsor'
                        : selectedTechnicianAccount?.accountName ?? 'Select account'
                    }
                  />
                  <SummaryMetric
                    label="Machine scope"
                    value={selectedTechnicianMachine ? selectedTechnicianMachine.machineLabel : 'Training only'}
                  />
                  <SummaryMetric
                    label="Existing grants"
                    value={isFetchingTechnicianContext ? 'Loading...' : String(technicianContext.grants.length)}
                  />
                </div>
                {hasTechnicianAccountEligibilityGap ? (
                  <PreviewBox>
                    Technician invites require a grantable customer account with an active Plus
                    Customer owner. {pluralize(technicianContext.ineligibleAccountCount, 'active account')}
                    {' '}currently needs Plus Customer ownership before it can sponsor Technician
                    access.
                  </PreviewBox>
                ) : (
                  <PreviewBox>
                    This will grant Technician training access to {normalizedEmail || 'the entered email'}
                    {selectedTechnicianMachine
                      ? ` plus reporting for ${selectedTechnicianMachine.machineLabel}.`
                      : ' with no reporting machine.'}{' '}
                    Technician access is limited to training-only or exactly one machine in this flow.
                  </PreviewBox>
                )}
              </div>
            </section>
          )}

          {isExistingUserPreset && (
            <section className="rounded-md border border-amber/40 bg-amber/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 text-amber" />
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground">{presetMeta.label} uses the person workspace</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preset === 'plus_customer'
                      ? 'Plus Customer access is account-oriented and should be managed from the selected person workspace so billing and existing grant state stay visible.'
                      : `${presetMeta.label} requires an existing authenticated user. Open the person workspace, review effective access, then use that access section with its preview and required reason.`}
                  </p>
                  <div className="mt-3">
                    {selectedExistingAccount ? (
                      <div className="rounded-md border border-border bg-background p-3 text-sm">
                        <p className="font-medium text-foreground">
                          {selectedExistingAccount.customer_email ?? 'No email on file'}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {selectedExistingAccount.user_id}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Search for and select an existing auth user before continuing.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {presetMeta.inviteable && (
            <section>
              <Label htmlFor="access-launcher-reason">Grant reason</Label>
              <Textarea
                id="access-launcher-reason"
                value={grantReason}
                onChange={(event) => setGrantReason(event.target.value)}
                placeholder="Required audit reason"
                className="mt-1"
              />
            </section>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 gap-2 border-t border-border bg-background/95 px-6 py-4 backdrop-blur sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {presetMeta.inviteable ? (
            <Button
              type="button"
              onClick={saveInviteableAccess}
              disabled={
                isSaving ||
                !canSaveInvite ||
                (preset === 'corporate_partner' && (!selectedPartner || !corporatePartnerWillHavePortalScope)) ||
                (preset === 'technician' && !selectedTechnicianAccount)
              }
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Grant and send invite
            </Button>
          ) : (
            <Button type="button" onClick={openSelectedWorkspace} disabled={!selectedExistingAccount}>
              <UserRound className="mr-2 h-4 w-4" />
              {existingPresetActionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const previewUnavailable = !identity.email && !effectiveAccess;
  const orderedPresets = presetOrder.filter((preset) => effectiveAccess?.presets.includes(preset));
  const derivedPresets =
    orderedPresets.length > 0
      ? orderedPresets
      : account?.has_plus_access
        ? ['Plus Customer']
        : [];
  const capabilities =
    effectiveAccess?.capabilities.map((capability) => capabilityLabels[capability] ?? capability) ?? [];
  const reportingMachineCount = effectiveAccess?.scopes.machineIds?.length ?? 0;
  const corporateSources = getCorporateSources(effectiveAccess);
  const technicianSources = getTechnicianSources(effectiveAccess);
  const manualReportingMachineCount = getManualReportingMachineIds(effectiveAccess).length;
  const hasScopedAdmin = Boolean(effectiveAccess?.presets.includes('Scoped Admin'));
  const hasSuperAdmin = Boolean(effectiveAccess?.presets.includes('Super Admin'));
  const nextExpiry = getSoonestFutureDate([
    account?.plus_grant_expires_at ?? plusSource.freeGrantExpiresAt,
    account?.membership_cancel_at_period_end ? account.current_period_end : null,
    ...corporateSources.map((source) => source.expiresAt),
    ...technicianSources.map((source) => source.expiresAt),
  ]);
  const activeSourceCount = [
    plusSource.hasPlusAccess || Boolean(account?.has_plus_access),
    corporateSources.some((source) => source.isActive),
    technicianSources.some((source) => source.isActive),
    hasScopedAdmin,
    hasSuperAdmin,
    manualReportingMachineCount > 0,
  ].filter(Boolean).length;
  const effectiveAccessValue = isLoading
    ? '...'
    : previewUnavailable
      ? derivedPresets.length
        ? `Partial preview: ${derivedPresets.join(', ')}`
        : 'Preview unavailable'
      : orderedPresets.length
        ? orderedPresets.join(', ')
        : 'Baseline';
  const capabilitiesValue = isLoading
    ? '...'
    : previewUnavailable
      ? 'Email required for full preview'
      : capabilities.length
        ? pluralize(capabilities.length, 'capability')
        : 'No elevated capabilities';
  const reportingScopeValue = isLoading
    ? '...'
    : previewUnavailable
      ? 'Email required for full preview'
      : pluralize(reportingMachineCount, 'reporting machine');

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

        <div className="grid gap-3 md:grid-cols-4">
          <SummaryMetric
            label="Effective access"
            value={effectiveAccessValue}
          />
          <SummaryMetric
            label="What can they do?"
            value={capabilitiesValue}
          />
          <SummaryMetric
            label="Where does it apply?"
            value={reportingScopeValue}
          />
          <SummaryMetric
            label="When does it expire?"
            value={nextExpiry ? formatDate(nextExpiry) : 'No expiry recorded'}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.55fr_0.45fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Effective presets
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {derivedPresets.length === 0 ? (
              <Badge variant="outline">{previewUnavailable ? 'Preview unavailable' : 'Baseline'}</Badge>
            ) : (
              derivedPresets.map((preset) => (
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
          label="Manual reporting machines"
          value={pluralize(manualReportingMachineCount, 'machine')}
        />
        <SummaryMetric
          label="Corporate Partner machines"
          value={pluralize(effectiveAccess?.scopes.corporatePartnerMachineIds?.length ?? 0, 'machine')}
        />
        <SummaryMetric
          label="Technician machines"
          value={pluralize(effectiveAccess?.scopes.technicianMachineIds?.length ?? 0, 'machine')}
        />
      </div>

      {previewUnavailable && (
        <div className="mt-4 rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-foreground">
          Effective access preview requires an email because the current backend preview RPC is
          email-based. Access sections that use user ID data remain available where safe.
        </div>
      )}

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
  const [sendingInviteMembershipId, setSendingInviteMembershipId] = useState<string | null>(null);
  const [isSavingPortalAccess, setIsSavingPortalAccess] = useState(false);
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

  const memberships = getCorporateMembershipsForIdentity(effectiveAccess, options.partners, identity);
  const activeMemberships = memberships.filter((membership) => membership.isActive);
  const activeMembershipIds = activeMemberships.map((membership) => membership.id).sort();
  const { data: inviteDeliveries = [], isFetching: isFetchingInviteDeliveries } = useQuery({
    queryKey: ['access-invite-deliveries', 'corporate_partner', activeMembershipIds],
    queryFn: () =>
      fetchAccessInviteDeliveries({
        inviteType: 'corporate_partner',
        sourceType: 'corporate_partner_membership',
        sourceIds: activeMembershipIds,
      }),
    enabled: activeMembershipIds.length > 0,
    staleTime: 1000 * 15,
  });
  const latestInviteBySourceId = useMemo(
    () => getLatestInviteDeliveryBySourceId(inviteDeliveries),
    [inviteDeliveries]
  );
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

  const sendCorporatePartnerInvite = async (membership: CorporatePartnerSourceRecord) => {
    const targetEmail = getCorporatePartnerInviteEmail(membership, identity);
    if (!targetEmail) {
      toast.error('This Corporate Partner membership does not have an invite email.');
      return;
    }
    const invitePreflight = validateAccessInvitePreflight('corporate_partner', targetEmail);
    if (!invitePreflight.ok) {
      toast.error(invitePreflight.message);
      return;
    }

    setSendingInviteMembershipId(membership.id);
    try {
      await sendAccessInvite({
        inviteType: 'corporate_partner',
        sourceId: membership.id,
        targetEmail: invitePreflight.targetEmail,
        loginUrl: invitePreflight.loginUrl,
      });
      toast.success('Corporate Partner invite email sent.');
      await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
    } catch (inviteError) {
      toast.error(
        inviteError instanceof Error ? inviteError.message : 'Unable to send Corporate Partner invite.'
      );
      await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
    } finally {
      setSendingInviteMembershipId(null);
    }
  };

  const copyCorporatePartnerInviteLink = async (membership: CorporatePartnerSourceRecord) => {
    const targetEmail = getCorporatePartnerInviteEmail(membership, identity);
    if (!targetEmail) {
      toast.error('This Corporate Partner membership does not have an invite email.');
      return;
    }
    const invitePreflight = validateAccessInvitePreflight('corporate_partner', targetEmail);
    if (!invitePreflight.ok) {
      toast.error(invitePreflight.message);
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard copy is not available in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(invitePreflight.loginUrl);
      toast.success('Login link copied.');
    } catch {
      toast.error('Unable to copy login link.');
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

  const savePortalAccessChanges = async (
    changes: Array<{ partyId: string; enabled: boolean }>,
    reason: string
  ) => {
    const normalizedReason = reason.trim();
    if (changes.length === 0) {
      toast.info('No partner-level portal access changes to save.');
      return;
    }
    if (!normalizedReason) {
      toast.error('Enter a reason before changing partner portal access.');
      return;
    }

    setIsSavingPortalAccess(true);
    try {
      for (const change of changes) {
        await setPartnershipPartyPortalAccess({
          partyId: change.partyId,
          enabled: change.enabled,
          reason: normalizedReason,
        });
      }
      toast.success('Partnership portal access updated.');
      setPortalReason('');
      await refreshOptions();
      await onChanged();
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Unable to update access.');
    } finally {
      setIsSavingPortalAccess(false);
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
          memberships.map((membership) => {
            const inviteDelivery = latestInviteBySourceId.get(membership.id);
            const inviteEmail = getCorporatePartnerInviteEmail(membership, identity);
            return (
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
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">Invite recovery</p>
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            {isFetchingInviteDeliveries
                              ? 'Checking invite delivery history...'
                              : formatInviteDeliverySummary(inviteDelivery)}
                          </p>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            Login email: {inviteEmail || 'No email on membership'}
                          </p>
                        </div>
                        <Badge
                          className="w-fit"
                          variant={
                            inviteDelivery?.deliveryStatus === 'sent'
                              ? 'default'
                              : inviteDelivery?.deliveryStatus === 'failed'
                                ? 'destructive'
                                : 'outline'
                          }
                        >
                          {inviteDelivery?.deliveryStatus === 'sent'
                            ? 'Invite sent'
                            : inviteDelivery?.deliveryStatus === 'failed'
                              ? 'Invite failed'
                              : 'No invite sent'}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!inviteEmail || sendingInviteMembershipId === membership.id}
                          onClick={() => void sendCorporatePartnerInvite(membership)}
                        >
                          {sendingInviteMembershipId === membership.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="mr-2 h-4 w-4" />
                          )}
                          {inviteDelivery ? 'Resend invite' : 'Send invite'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!inviteEmail}
                          onClick={() => void copyCorporatePartnerInviteLink(membership)}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy login link
                        </Button>
                      </div>
                    </div>
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
            );
          })
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
            Grant access only
          </Button>
          <p className="text-xs text-muted-foreground">
            This creates or updates the Corporate Partner membership. It does not email the person;
            use Send invite on an active membership above.
          </p>
        </div>
        <div className="space-y-3">
          <PreviewBox>
            This will give {identity.label} Corporate Partner benefits for {selectedPartner?.partnerName ?? 'the selected partner'}.
            Today that means {pluralize(portalEnabledPartnerships.length, 'portal-enabled partnership')} and{' '}
            {pluralize(derivedMachineIds.size, 'derived reporting machine')}. Email is separate so
            admins can resend or copy the login link without changing access.
          </PreviewBox>
          {selectedPartner && (
            <PartnerPortalAccessControls
              partner={selectedPartner}
              portalReason={portalReason}
              setPortalReason={setPortalReason}
              isSaving={isSavingPortalAccess}
              savePortalAccessChanges={savePortalAccessChanges}
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
  isSaving,
  savePortalAccessChanges,
}: {
  partner: CorporatePartnerOption;
  portalReason: string;
  setPortalReason: (value: string) => void;
  isSaving: boolean;
  savePortalAccessChanges: (
    changes: Array<{ partyId: string; enabled: boolean }>,
    reason: string
  ) => Promise<void>;
}) {
  const portalStateSignature = partner.portalPartnerships
    .map((partnership) => `${partnership.partyId}:${partnership.portalAccessEnabled}`)
    .join('|');
  const [draftPortalAccess, setDraftPortalAccess] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraftPortalAccess(
      Object.fromEntries(
        partner.portalPartnerships.map((partnership) => [
          partnership.partyId,
          partnership.portalAccessEnabled,
        ])
      )
    );
  }, [partner.partnerId, partner.portalPartnerships, portalStateSignature]);

  const portalChanges = partner.portalPartnerships
    .map((partnership) => ({
      partyId: partnership.partyId,
      partnershipName: partnership.partnershipName,
      enabled: draftPortalAccess[partnership.partyId] ?? partnership.portalAccessEnabled,
      currentlyEnabled: partnership.portalAccessEnabled,
    }))
    .filter((change) => change.enabled !== change.currentlyEnabled);

  return (
    <div className="rounded-md border border-amber/40 bg-amber/10 p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 text-amber" />
        <div>
          <p className="text-sm font-medium text-foreground">Partner-level portal access</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This affects every Corporate Partner member for this partner record, not only the
            selected person. Review the staged changes before saving.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor="partner-portal-reason">Reason for partner-level changes</Label>
        <Input
          id="partner-portal-reason"
          value={portalReason}
          onChange={(event) => setPortalReason(event.target.value)}
          placeholder="Required before saving partner-level changes"
        />
      </div>
      <div className="mt-3 divide-y divide-border rounded-md border border-border">
        {partner.portalPartnerships.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No active partnerships are linked.</p>
        ) : (
          partner.portalPartnerships.map((partnership) => (
            <label key={partnership.partyId} className="flex cursor-pointer items-start gap-3 p-3">
              <Checkbox
                checked={draftPortalAccess[partnership.partyId] ?? partnership.portalAccessEnabled}
                disabled={isSaving}
                onCheckedChange={(checked) =>
                  setDraftPortalAccess((current) => ({
                    ...current,
                    [partnership.partyId]: checked === true,
                  }))
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
      <PreviewBox tone="warning">
        {portalChanges.length === 0
          ? 'No partner-level changes are staged.'
          : `This will change ${pluralize(
              portalChanges.length,
              'partnership'
            )}: ${portalChanges
              .map((change) => `${change.partnershipName} -> ${change.enabled ? 'enabled' : 'disabled'}`)
              .join(', ')}.`}
      </PreviewBox>
      <Button
        className="mt-3"
        variant="outline"
        onClick={() =>
          void savePortalAccessChanges(
            portalChanges.map((change) => ({ partyId: change.partyId, enabled: change.enabled })),
            portalReason
          )
        }
        disabled={isSaving || portalChanges.length === 0 || !portalReason.trim()}
      >
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save partner-level changes
      </Button>
    </div>
  );
}

function TechnicianAccessCard({
  identity,
  effectiveAccess,
  onChanged,
}: {
  identity: AccessWorkspaceIdentity;
  effectiveAccess: EffectiveAccessContext | null;
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const sourceGrants = getTechnicianSources(effectiveAccess);
  const activeSourceGrants = sourceGrants.filter((grant) => grant.isActive);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedScopeValue, setSelectedScopeValue] = useState(trainingOnlyScopeValue);
  const [grantReason, setGrantReason] = useState('');
  const [scopeDrafts, setScopeDrafts] = useState<Record<string, string>>({});
  const [scopeReasons, setScopeReasons] = useState<Record<string, string>>({});
  const [renewReasons, setRenewReasons] = useState<Record<string, string>>({});
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [savingScopeGrantId, setSavingScopeGrantId] = useState<string | null>(null);
  const [renewingGrantId, setRenewingGrantId] = useState<string | null>(null);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

  const {
    data: technicianContext = emptyTechnicianAccessContext,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-technician-access-context', identity.email],
    queryFn: () => fetchAdminTechnicianAccessContext(identity.email as string),
    enabled: Boolean(identity.email),
    staleTime: 1000 * 20,
  });

  const accounts = technicianContext.accounts;
  const grants = technicianContext.grants;
  const activeGrants = grants.filter((grant) => grant.isActive && !grant.revokedAt);
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.accountId === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const selectedAccountMachines = useMemo(
    () => selectedAccount?.machines ?? [],
    [selectedAccount]
  );
  const selectedMachineId = getMachineScopeId(selectedScopeValue);
  const selectedMachine =
    selectedMachineId && selectedAccountMachines.find((machine) => machine.machineId === selectedMachineId);

  useEffect(() => {
    const firstActiveGrant = grants.find((grant) => !grant.revokedAt) ?? null;
    const nextAccountId = firstActiveGrant?.accountId ?? accounts[0]?.accountId ?? '';
    setSelectedAccountId(nextAccountId);
    setSelectedScopeValue(firstActiveGrant ? getGrantMachineScopeValue(firstActiveGrant) : trainingOnlyScopeValue);
    setGrantReason('');
    setScopeDrafts(
      Object.fromEntries(grants.map((grant) => [grant.grantId, getGrantMachineScopeValue(grant)]))
    );
    setScopeReasons({});
    setRenewReasons({});
    setRevokeReasons({});
  }, [accounts, grants, identity.email, identity.userId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    if (
      selectedScopeValue !== trainingOnlyScopeValue &&
      !selectedAccountMachines.some((machine) => machine.machineId === selectedScopeValue)
    ) {
      setSelectedScopeValue(trainingOnlyScopeValue);
    }
  }, [selectedAccountId, selectedAccountMachines, selectedScopeValue]);

  const refreshTechnicianContext = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-technician-access-context'] });
  };

  const handleSaveGrant = async () => {
    if (!identity.email) {
      toast.error('Technician access requires an email.');
      return;
    }
    if (!selectedAccountId) {
      toast.error('Select an account.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Reason is required.');
      return;
    }

    setIsSavingGrant(true);
    try {
      await adminGrantTechnicianAccess({
        email: identity.email,
        accountId: selectedAccountId,
        machineId: selectedMachineId,
        reason: grantReason.trim(),
      });
      trackEvent('admin_technician_access_saved', {
        target_user_id: identity.userId,
        machine_count: selectedMachineId ? 1 : 0,
      });
      toast.success('Technician access saved.');
      setGrantReason('');
      await refreshTechnicianContext();
      await onChanged();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to save Technician access.');
    } finally {
      setIsSavingGrant(false);
    }
  };

  const handleSaveScope = async (grant: AdminTechnicianGrant) => {
    const reason = scopeReasons[grant.grantId]?.trim() ?? '';
    if (!reason) {
      toast.error('Scope change reason is required.');
      return;
    }

    setSavingScopeGrantId(grant.grantId);
    try {
      await adminUpdateTechnicianMachines({
        grantId: grant.grantId,
        machineId: getMachineScopeId(scopeDrafts[grant.grantId] ?? getGrantMachineScopeValue(grant)),
        reason,
      });
      trackEvent('admin_technician_scope_updated', {
        target_user_id: grant.technicianUserId,
        grant_id: grant.grantId,
      });
      toast.success('Technician machine scope saved.');
      setScopeReasons((current) => ({ ...current, [grant.grantId]: '' }));
      await refreshTechnicianContext();
      await onChanged();
    } catch (scopeError) {
      toast.error(scopeError instanceof Error ? scopeError.message : 'Unable to save Technician scope.');
    } finally {
      setSavingScopeGrantId(null);
    }
  };

  const handleRenewGrant = async (grant: AdminTechnicianGrant) => {
    const reason = renewReasons[grant.grantId]?.trim() ?? '';
    if (!reason) {
      toast.error('Renewal reason is required.');
      return;
    }

    setRenewingGrantId(grant.grantId);
    try {
      await adminRenewTechnicianAccess({ grantId: grant.grantId, reason });
      trackEvent('admin_technician_access_renewed', {
        target_user_id: grant.technicianUserId,
        grant_id: grant.grantId,
      });
      toast.success('Technician access renewed.');
      setRenewReasons((current) => ({ ...current, [grant.grantId]: '' }));
      await refreshTechnicianContext();
      await onChanged();
    } catch (renewError) {
      toast.error(renewError instanceof Error ? renewError.message : 'Unable to renew Technician access.');
    } finally {
      setRenewingGrantId(null);
    }
  };

  const handleRevokeGrant = async (grant: AdminTechnicianGrant) => {
    const reason = revokeReasons[grant.grantId]?.trim() ?? '';
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingGrantId(grant.grantId);
    try {
      await adminRevokeTechnicianAccess({ grantId: grant.grantId, reason });
      trackEvent('admin_technician_access_revoked', {
        target_user_id: grant.technicianUserId,
        grant_id: grant.grantId,
      });
      toast.success('Technician access revoked.');
      setRevokeReasons((current) => ({ ...current, [grant.grantId]: '' }));
      await refreshTechnicianContext();
      await onChanged();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke Technician access.');
    } finally {
      setRevokingGrantId(null);
    }
  };

  return (
    <SourceCard
      icon={Wrench}
      title="Technician"
      status={activeGrants.length > 0 || activeSourceGrants.length > 0 ? 'Active' : 'Inactive'}
      description="Super Admin controls for Technician training access and one-machine reporting scope."
    >
      {!identity.email && (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          Select or enter an email before managing Technician access.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Unable to load Admin Technician controls.'}
        </div>
      )}

      {identity.email && !error && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric
              label="Technician source"
              value={isFetching ? 'Refreshing...' : activeGrants.length > 0 ? 'Active' : 'No active grant'}
            />
            <SummaryMetric
              label="Current admin scope"
              value={pluralize(activeGrants.reduce((total, grant) => total + grant.machines.filter((machine) => machine.isActive).length, 0), 'machine')}
            />
            <SummaryMetric
              label="Available machines"
              value={pluralize(accounts.reduce((total, account) => total + account.machineCount, 0), 'machine')}
            />
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="grid gap-3 md:grid-cols-[0.32fr_0.28fr_0.4fr]">
              <div>
                <Label htmlFor="admin-technician-account">Account</Label>
                <select
                  id="admin-technician-account"
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={isFetching || accounts.length === 0}
                >
                  {accounts.map((account) => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.accountName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="admin-technician-machine">Machine scope</Label>
                <select
                  id="admin-technician-machine"
                  value={selectedScopeValue}
                  onChange={(event) => setSelectedScopeValue(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={isFetching || !selectedAccountId}
                >
                  <option value={trainingOnlyScopeValue}>Training only - no machine</option>
                  {selectedAccountMachines.map((machine) => (
                    <option key={machine.machineId} value={machine.machineId}>
                      {machine.machineLabel}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="admin-technician-reason">Grant or update reason</Label>
                <Input
                  id="admin-technician-reason"
                  value={grantReason}
                  onChange={(event) => setGrantReason(event.target.value)}
                  placeholder="Required reason"
                />
              </div>
            </div>
            <PreviewBox>
              Saving gives {identity.label} Technician training access
              {selectedMachine
                ? ` plus viewer reporting for ${selectedMachine.machineLabel}.`
                : ' with no assigned reporting machine.'}{' '}
              This does not grant Plus Customer, Corporate Partner, billing, supply discount, or
              admin privileges. Switching to training-only revokes only Technician-sourced reporting
              entitlements; unrelated manual reporting grants remain unchanged.
            </PreviewBox>
            <Button
              className="mt-3"
              onClick={handleSaveGrant}
              disabled={isSavingGrant || isFetching || !selectedAccountId || !identity.email}
            >
              {isSavingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Technician access
            </Button>
          </div>

          {grants.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No Technician source has been created for this person.
            </div>
          ) : (
            <div className="space-y-3">
              {grants.map((grant) => {
                const accountMachines = getAccountMachines(accounts, grant.accountId);
                const activeMachineCount = grant.machines.filter((machine) => machine.isActive).length;
                const draftScope = scopeDrafts[grant.grantId] ?? getGrantMachineScopeValue(grant);
                const draftMachine = getMachineScopeId(draftScope);

                return (
                  <div key={grant.grantId} className="rounded-md border border-border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{grant.accountName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Sponsor: {grant.partnerName ?? grant.sponsorType} / expires {formatDate(grant.expiresAt)}
                        </p>
                      </div>
                      <Badge className="w-fit" variant={grant.isActive ? 'default' : 'outline'}>
                        {grant.revokedAt ? 'revoked' : grant.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <SummaryMetric label="Machine scope" value={activeMachineCount === 0 ? 'Training only' : pluralize(activeMachineCount, 'machine')} />
                      <SummaryMetric label="Reporting rows" value={String(grant.activeReportingEntitlementCount)} />
                      <SummaryMetric label="Grant reason" value={grant.grantReason || 'Technician access'} />
                    </div>

                    {!grant.revokedAt && (
                      <div className="mt-3 space-y-3">
                        <PreviewBox>
                          Scope changes renew the Technician grant and replace only this
                          Technician source's reporting machine. Manual reporting grants and other
                          access sources are not removed.
                        </PreviewBox>
                        <div className="grid gap-3 lg:grid-cols-[0.28fr_0.42fr_0.3fr]">
                          <div>
                            <Label htmlFor={`technician-scope-${grant.grantId}`}>Scope after save</Label>
                            <select
                              id={`technician-scope-${grant.grantId}`}
                              value={draftScope}
                              onChange={(event) =>
                                setScopeDrafts((current) => ({
                                  ...current,
                                  [grant.grantId]: event.target.value,
                                }))
                              }
                              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                              <option value={trainingOnlyScopeValue}>Training only - no machine</option>
                              {accountMachines.map((machine) => (
                                <option key={machine.machineId} value={machine.machineId}>
                                  {machine.machineLabel}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label htmlFor={`technician-scope-reason-${grant.grantId}`}>Scope reason</Label>
                            <Input
                              id={`technician-scope-reason-${grant.grantId}`}
                              value={scopeReasons[grant.grantId] ?? ''}
                              onChange={(event) =>
                                setScopeReasons((current) => ({
                                  ...current,
                                  [grant.grantId]: event.target.value,
                                }))
                              }
                              placeholder="Required for machine changes"
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              className="w-full"
                              variant="outline"
                              onClick={() => void handleSaveScope(grant)}
                              disabled={savingScopeGrantId === grant.grantId || !scopeReasons[grant.grantId]?.trim()}
                            >
                              {savingScopeGrantId === grant.grantId ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              Save scope
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Preview: {draftMachine ? 'one assigned reporting machine' : 'training-only access'} after save.
                        </p>

                        <div className="grid gap-3 lg:grid-cols-[0.7fr_0.3fr]">
                          <div>
                            <Label htmlFor={`technician-renew-reason-${grant.grantId}`}>Renewal reason</Label>
                            <Input
                              id={`technician-renew-reason-${grant.grantId}`}
                              value={renewReasons[grant.grantId] ?? ''}
                              onChange={(event) =>
                                setRenewReasons((current) => ({
                                  ...current,
                                  [grant.grantId]: event.target.value,
                                }))
                              }
                              placeholder="Required to renew current scope"
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              className="w-full"
                              variant="outline"
                              onClick={() => void handleRenewGrant(grant)}
                              disabled={renewingGrantId === grant.grantId || !renewReasons[grant.grantId]?.trim()}
                            >
                              {renewingGrantId === grant.grantId ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                              )}
                              Renew
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[0.7fr_0.3fr]">
                          <div>
                            <Label htmlFor={`technician-revoke-reason-${grant.grantId}`}>Revoke reason</Label>
                            <Input
                              id={`technician-revoke-reason-${grant.grantId}`}
                              value={revokeReasons[grant.grantId] ?? ''}
                              onChange={(event) =>
                                setRevokeReasons((current) => ({
                                  ...current,
                                  [grant.grantId]: event.target.value,
                                }))
                              }
                              placeholder="Required to revoke"
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              className="w-full"
                              variant="outline"
                              onClick={() => void handleRevokeGrant(grant)}
                              disabled={revokingGrantId === grant.grantId || !revokeReasons[grant.grantId]?.trim()}
                            >
                              {revokingGrantId === grant.grantId ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              Revoke
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
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
  const originalMachineSignature = useMemo(
    () => [...originalMachineIds].sort((a, b) => a.localeCompare(b)).join('|'),
    [originalMachineIds]
  );
  const existingGrantLevels = useMemo(
    () => uniqueValues([...machineGrantByMachineId.values()].map((grant) => grant.accessLevel)),
    [machineGrantByMachineId]
  );

  useEffect(() => {
    setSelectedMachineIds(new Set(originalMachineIds));
    setAccessLevel(
      existingGrantLevels.length === 1
        ? (existingGrantLevels[0] as ReportingAccessLevel)
        : 'viewer'
    );
    setAccessReason('');
    setMachineSearch('');
  }, [existingGrantLevels, identity.email, identity.userId, originalMachineSignature, originalMachineIds]);

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
        <SummaryMetric
          label="Existing levels"
          value={
            existingGrantLevels.length === 0
              ? 'No manual grants'
              : existingGrantLevels.map((level) => formatReportingAccessLevel(level as ReportingAccessLevel)).join(', ')
          }
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
              <Label htmlFor="manual-reporting-level">Level for newly added machines</Label>
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
            Corporate Partner, Technician, and Scoped Admin sources is not changed. Existing manual
            grants that remain selected keep their current access level.
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
            grantByMachineId={machineGrantByMachineId}
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
    () => [...roles].sort(roleSort).find((candidate) => identityMatches(identity, candidate)) ?? null,
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
  grantByMachineId,
}: {
  groupedMachines: Array<{ key: string; accountName: string; machines: AdminReportingAccessMachine[] }>;
  selectedMachineIds: Set<string>;
  toggleMachine: (machineId: string, checked: boolean) => void;
  isFetching: boolean;
  grantByMachineId?: Map<string, AdminReportingAccessGrant>;
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
                  {grantByMachineId?.has(machine.id)
                    ? ` / current manual level ${formatReportingAccessLevel(
                        grantByMachineId.get(machine.id)?.accessLevel ?? 'viewer'
                      )}`
                    : ''}
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
  const corporateSources = getCorporateSources(effectiveAccess);
  const technicianSources = getTechnicianSources(effectiveAccess);
  const nextExpiry = getSoonestFutureDate([
    ...corporateSources.map((source) => source.expiresAt),
    ...technicianSources.map((source) => source.expiresAt),
  ]);

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
          label="Manual-only machines"
          value={pluralize(getManualReportingMachineIds(effectiveAccess).length, 'machine')}
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
        <SummaryMetric
          label="Next source expiry"
          value={nextExpiry ? formatDate(nextExpiry) : 'No expiry recorded'}
        />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Manual reporting access is shown in its own access section because it can be changed independently
        from derived access sources.
      </p>
    </div>
  );
}

function GlobalActivityPanel() {
  const [auditSearchDraft, setAuditSearchDraft] = useState('');
  const [submittedAuditSearch, setSubmittedAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const auditSearch = submittedAuditSearch.trim();

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
  const handleAuditSearchSubmit = () => {
    setSubmittedAuditSearch(auditSearchDraft.trim());
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-semibold text-foreground">Global activity</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Secondary audit search for role and access operations. Person-specific activity appears
          inside the selected-person workspace.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(140px,0.55fr)_minmax(140px,0.55fr)_auto]">
        <Input
          aria-label="Search audit log"
          value={auditSearchDraft}
          onChange={(event) => setAuditSearchDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleAuditSearchSubmit();
          }}
          placeholder="Search audit log"
        />
        <select
          aria-label="Filter audit log by action"
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
          aria-label="Filter audit log by entity"
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
        <Button type="button" variant="outline" onClick={handleAuditSearchSubmit}>
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
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
