import { fetchMachineSourceInventorySnapshot, fetchImportedSourceReuseOptions, reuseImportedSourceMachine, setupImportedMachine, previewImportedReaderChange, setMachineSourceState, machineSourceInventoryQueryKey, type MachineSourceInventoryItem } from '@/lib/machineSourceInventory';
import { MachineHelp } from '@/components/admin/MachineHelp';
import { saveMachineRefundSettings } from '@/lib/machineWorkspace';
import { MachineCashReporting } from '@/components/admin/MachineCashReporting';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Filter,
  X,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ServerCog,
  Users,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MachineEmailAlerts } from '@/components/email-alerts/MachineEmailAlerts';
import { useAuth } from '@/contexts/auth-context';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { TaxTreatmentFields, type TaxTreatmentDraft } from '@/components/portal/reports/TaxTreatmentFields';
import { fetchReportingTaxTreatments, getEffectiveReportingTaxTreatment, saveReportingTaxConfiguration, type ReportingTaxTender, type ReportingTaxTreatmentValues } from '@/lib/reportingTaxTreatment';
import {
  fetchPartnershipReportingSetup,
  setReportingMachineTaxRateAdmin,
  type PartnershipReportingSetup,
  type PartnershipSetupMachine,
  type ReportingMachineTaxRate,
} from '@/lib/partnershipReporting';
import {
  fetchAccessInviteDeliveries,
  sendAccessInvite,
  validateAccessInvitePreflight,
  type AccessInviteDelivery,
} from '@/lib/accessInvites';
import {
  fetchAdminAccountSummaries,
  type AdminAccountSummary,
} from '@/lib/adminAccounts';
import {
  activateQualifiedRefundMachinesAdmin,
  fetchRefundManagerSetup,
  fetchRefundNayaxInventory,
  isLocalUatDemoForced,
  reconcileRefundNayaxMachineAdmin,
  setMachineRefundManagersAdmin,
  setRefundMachineCardActivationAdmin,
  type RefundManagerSetup,
  type RefundNayaxInventory,
  type RefundNayaxInventoryCategory,
  type RefundNayaxInventoryMachine,
  type RefundNayaxInventoryState,
} from '@/lib/refundOperations';
import {
  lookupReportingUserByEmailAdmin,
  upsertReportingMachineAdmin,
  type ReportingMachineOperationalPhase,
} from '@/lib/reporting';
import { normalizeMachineType, type CanonicalMachineType } from '@/lib/machineTypes';
import { cn } from '@/lib/utils';
import { CompanyAssignmentFields } from '@/components/admin/CompanyAssignmentFields';
import { NayaxMachinePicker } from '@/components/admin/NayaxMachinePicker';
import { MachineIdentityMapping } from '@/components/admin/MachineIdentityMapping';
import { fetchMachineWorkspaceMetadata, machineWorkspaceQueryKey, type MachineWorkspaceMetadata } from '@/lib/machineWorkspace';
import { transactionAge, transactionAgeLabel, importFreshnessLabel, transactionSourceLabel } from '@/lib/machineTransactionRecency';
import { CompanyManagementSheet } from '@/components/admin/CompanyManagementSheet';
import { MachineMobileCard } from '@/components/admin/MachineMobileCard';
import { registerMachineNavigationGuard } from '@/lib/machineNavigationGuard';
import { customerRefundPublication, isExactMachineRefundReader, machineRefundAvailability } from '@/lib/machineRefundReadiness';
import { validateCompanyAssignment, type SavedCompanyAssignment } from '@/lib/companyAssignment';
import { companyChoicesQueryKey, fetchCompanyChoices } from '@/lib/companyAssignmentApi';
import {
  formatMachineType,
  formatLabel,
  formatDate,
  getActiveMachineAssignments,
  getCurrentTaxRate,
  getTaxStatus,
  getTaxStatusLabel,
  machineTypes,
  type TaxStatus,
  today,
} from '@/pages/admin/reportingSetupUi';

type MachineTaxFilter = 'all' | TaxStatus;
type MachineAssignmentFilter = 'all' | 'unassigned' | 'overlap';
type MachineTypeFilter = 'all' | CanonicalMachineType;
type MachineRefundFilter = 'all' | 'ready' | 'direct_blocked' | 'setup' | 'paused';
type MachineActivityFilter = 'all' | 'recent' | 'no_sales' | 'idle';
type MachineSort = 'status' | 'machine' | 'latest_sale' | 'oldest';
type MachineView = 'all' | 'setup' | 'attention' | 'ready' | 'review' | 'inactive';
type MachineDetailTab = 'overview' | 'refunds' | 'managers' | 'reporting' | 'activity';
type MachineAttentionReason = {
  code: string;
  label: string;
  nextStep: string;
  tab: MachineDetailTab;
};
type MachineSetupRowViewModel = {
  machine: PartnershipSetupMachine;
  taxRate: ReportingMachineTaxRate | undefined;
  taxStatus: TaxStatus;
  activeAssignments: PartnershipReportingSetup['assignments'];
  machineWarnings: PartnershipReportingSetup['warnings'];
  machineManagerEmails: string[];
  refundIntakeEnabled: boolean;
  nayaxLookupConfigured: boolean;
  refundReadinessState: 'ready_to_refund' | 'ready_to_activate' | 'setup_needed';
  refundCardEnabled: boolean;
  refundLimitCents: number | null;
  refundBlockReason: string | null;
  draftValue: string;
  attentionReasons: MachineAttentionReason[];
};

type RefundReadinessDraft = {
  displayLabel: string;
  normalizedNayaxMachineId: string;
  normalizedNayaxAccountKey: string;
};

type DemoRefundReadiness = {
  refundIntakeEnabled: boolean;
  refundPublicDisplayLabel: string | null;
  nayaxMachineId: string | null;
  nayaxAccountKey: string | null;
};

const setupQueryKey = ['admin-partnership-reporting-setup'];
const refundManagerSetupQueryKey = ['admin-refund-manager-setup'];
const refundNayaxInventoryQueryKey = ['admin-refund-nayax-inventory'];
const initialReportingTaxStartDate = '2026-01-01';

const refundReadinessLabel = (state: MachineSetupRowViewModel['refundReadinessState']) => ({
  ready_to_refund: 'Ready to refund',
  ready_to_activate: 'Ready to activate',
  setup_needed: 'Setup needed',
}[state]);

const refundReasonLabel = (reason: string | null) => ({
  customer_intake_unavailable: 'Customer intake unavailable',
  transaction_matching_off: 'Transaction matching is off',
  transaction_lookup_not_ready: 'Transaction lookup needs setup',
  manager_route_not_ready: 'Machine Manager route needs setup',
  awaiting_reviewed_activation: 'Awaiting reviewed activation',
  owner_pause: 'Paused by owner',
  provider_support: 'Paused for provider support',
  machine_maintenance: 'Paused for machine maintenance',
  commercial_exception: 'Approved commercial exception',
}[reason ?? ''] ?? 'Review setup');

const emptySetup: PartnershipReportingSetup = {
  partners: [],
  partnerships: [],
  machines: [],
  assignments: [],
  parties: [],
  taxRates: [],
  financialRules: [],
  warnings: [],
};

const emptyRefundManagerSetup: RefundManagerSetup = {
  machines: [],
  standardLaunchLimitCents: null,
  globalRefunds: { available: false, paused: true, blockReason: 'configuration_missing' },
};

const demoRefundNayaxInventory: RefundNayaxInventory = {
  summary: { active: 3, published: 1, needsSetup: 1, excluded: 1, stalePublished: 0 },
  lastRun: {
    status: 'completed',
    completedAt: new Date().toISOString(),
    errorCode: null,
    activeCount: 3,
    previousActiveCount: 3,
    largeDrop: false,
  },
  machines: [
    {
      id: 'demo-inventory-published', accountKey: 'DEMO_ACCOUNT', nayaxMachineId: 'DEMO-1001',
      machineName: 'Refund UAT Cotton Candy 01', machineNumber: '1001', providerActive: true,
      category: 'cotton_candy', reportingMachineId: 'demo-machine-1', state: 'published',
      setupReason: 'ready', exclusionReason: null, missingSuccessfulSnapshots: 0,
      lastSeenAt: new Date().toISOString(), lastSuccessfulSyncAt: new Date().toISOString(),
    },
    {
      id: 'demo-inventory-snapcase', accountKey: 'DEMO_ACCOUNT', nayaxMachineId: 'DEMO-2001',
      machineName: 'Snapcase UAT 01', machineNumber: '2001', providerActive: true,
      category: 'snapcase', reportingMachineId: null, state: 'needs_setup',
      setupReason: 'exact_mapping_required', exclusionReason: null, missingSuccessfulSnapshots: 0,
      lastSeenAt: new Date().toISOString(), lastSuccessfulSyncAt: new Date().toISOString(),
    },
    {
      id: 'demo-inventory-excluded', accountKey: 'DEMO_ACCOUNT', nayaxMachineId: 'DEMO-TEST',
      machineName: 'Synthetic provider test machine', machineNumber: null, providerActive: true,
      category: null, reportingMachineId: null, state: 'excluded', setupReason: 'explicitly_excluded',
      exclusionReason: 'Synthetic test machine', missingSuccessfulSnapshots: 0,
      lastSeenAt: new Date().toISOString(), lastSuccessfulSyncAt: new Date().toISOString(),
    },
  ],
};

const emptyAccountSummaries: AdminAccountSummary[] = [];
const demoMachineManagerAccounts: AdminAccountSummary[] = [
  {
    user_id: 'demo-manager-1',
    customer_email: 'manager-one@example.test',
    membership_status: null,
    current_period_end: null,
    membership_cancel_at_period_end: false,
    paid_subscription_active: false,
    plus_access_source: 'none',
    has_plus_access: false,
    plus_grant_id: null,
    plus_grant_starts_at: null,
    plus_grant_expires_at: null,
    plus_grant_active: false,
    total_orders: 0,
    last_order_at: null,
    open_support_requests: 0,
    total_machine_count: 0,
    last_machine_update_at: null,
  },
  {
    user_id: 'demo-manager-2',
    customer_email: 'manager-two@example.test',
    membership_status: null,
    current_period_end: null,
    membership_cancel_at_period_end: false,
    paid_subscription_active: false,
    plus_access_source: 'none',
    has_plus_access: false,
    plus_grant_id: null,
    plus_grant_starts_at: null,
    plus_grant_expires_at: null,
    plus_grant_active: false,
    total_orders: 0,
    last_order_at: null,
    open_support_requests: 0,
    total_machine_count: 0,
    last_machine_update_at: null,
  },
  {
    user_id: 'demo-manager-3',
    customer_email: 'operator-three@example.test',
    membership_status: null,
    current_period_end: null,
    membership_cancel_at_period_end: false,
    paid_subscription_active: false,
    plus_access_source: 'none',
    has_plus_access: false,
    plus_grant_id: null,
    plus_grant_starts_at: null,
    plus_grant_expires_at: null,
    plus_grant_active: false,
    total_orders: 0,
    last_order_at: null,
    open_support_requests: 0,
    total_machine_count: 0,
    last_machine_update_at: null,
  },
];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emptyMachineForm = {
  machineId: null as string | null,
  accountId: '',
  locationId: '',
  addLocation: false,
  locationName: '',
  locationTimezone: '',
  machineLabel: '',
  machineType: 'commercial' as CanonicalMachineType | '',
  sunzeMachineId: '',
  operationalPhase: 'live' as ReportingMachineOperationalPhase,
};

const treatmentDraft = (value: ReportingTaxTreatmentValues): TaxTreatmentDraft => ({ amountBasis: value.amountBasis, taxablePortionPercent: String(value.taxablePortionPercent) });
const emptyTaxChangeForm = {
  machineId: '',
  taxRatePercent: '',
  effectiveStartDate: today(),
  reason: '',
  cardTreatment: null as TaxTreatmentDraft | null,
  cashTreatment: null as TaxTreatmentDraft | null,
};

const parseTaxFilter = (_value: string | null): MachineTaxFilter => 'all';

const parseAssignmentFilter = (value: string | null): MachineAssignmentFilter => {
  if (value === 'unassigned' || value === 'overlap') return value;
  return 'all';
};

const parseMachineView = (value: string | null): MachineView => {
  if (value === 'setup' || value === 'attention' || value === 'ready' || value === 'review' || value === 'inactive') return value;
  return 'all';
};

const parseMachineTypeFilter = (value: string | null): MachineTypeFilter =>
  value && machineTypes.includes(value as CanonicalMachineType)
    ? (value as CanonicalMachineType)
    : 'all';

const parseRefundFilter = (value: string | null): MachineRefundFilter => {
  if (value === 'ready' || value === 'direct_blocked' || value === 'setup' || value === 'paused') return value;
  return 'all';
};

const parseActivityFilter = (value: string | null): MachineActivityFilter => {
  if (value === 'recent' || value === 'no_sales' || value === 'idle') return value;
  return 'all';
};

const parseMachineSort = (value: string | null): MachineSort => {
  if (value === 'machine' || value === 'latest_sale' || value === 'oldest') return value;
  return 'status';
};

const formatUpdatedAt = (value: string | number | Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Update time unavailable';
  return `Updated ${date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
};

const parseMachineDetailTab = (value: string | null): MachineDetailTab => {
  if (
    value === 'refunds' ||
    value === 'managers' ||
    value === 'reporting' ||
    value === 'activity'
  ) {
    return value;
  }
  return 'overview';
};

const normalizeComparableText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const uniqueEmails = (values: string[]) =>
  Array.from(new Set(values.map(normalizeEmail).filter(Boolean)));

const emailListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((email, index) => email === right[index]);

const formatMachineManagerInviteSummary = (delivery: AccessInviteDelivery | null | undefined) => {
  if (!delivery) return 'No Machine Manager signup invite has been sent for this machine yet.';

  const sentAt = formatDate(delivery.sentAt);

  return delivery.deliveryStatus === 'sent'
    ? `Last invite sent ${sentAt} to ${delivery.targetEmail}.`
    : `Last invite failed ${sentAt}${delivery.errorMessage ? `: ${delivery.errorMessage}` : '.'}`;
};

const buildLocalMachineManagerDemoSetup = (): PartnershipReportingSetup => ({
  ...emptySetup,
  machines: [
    {
      id: 'demo-machine-1',
      machine_label: 'Refund UAT Cotton Candy 01',
      machine_type: 'commercial',
      sunze_machine_id: 'DEMO-SUNZE-01',
      status: 'active',
      operational_phase: 'live',
      account_id: 'demo-company-1',
      location_id: 'demo-location-1',
      location_timezone: 'America/New_York',
      account_name: 'Refund UAT Synthetic Account',
      location_name: 'Refund UAT Mall',
      latest_sale_date: today(),
    },
    {
      id: 'demo-machine-2',
      machine_label: 'Refund UAT Cotton Candy 02',
      machine_type: 'commercial',
      sunze_machine_id: 'DEMO-SUNZE-02',
      status: 'active',
      operational_phase: 'live',
      account_id: 'demo-company-1',
      location_id: 'demo-location-2',
      location_timezone: 'America/Chicago',
      account_name: 'Refund UAT Synthetic Account',
      location_name: 'Refund UAT Arcade',
      latest_sale_date: today(),
    },
  ],
});

export default function AdminMachinesPage() {
  const queryClient = useQueryClient();
  const { user, isScopedAdmin, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { machineId: routeMachineId, sourceKey: routeSourceKey } = useParams<{ machineId?: string; sourceKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [view, setView] = useState<MachineView>(() => parseMachineView(searchParams.get('view')));
  const [companyFilter, setCompanyFilter] = useState(() => searchParams.get('company') ?? 'all');
  const [taxFilter, setTaxFilter] = useState<MachineTaxFilter>(() => parseTaxFilter(searchParams.get('tax')));
  const [assignmentFilter, setAssignmentFilter] = useState<MachineAssignmentFilter>(() =>
    parseAssignmentFilter(searchParams.get('assignment'))
  );
  const [machineTypeFilter, setMachineTypeFilter] = useState<MachineTypeFilter>(() =>
    parseMachineTypeFilter(searchParams.get('type'))
  );
  const [refundFilter, setRefundFilter] = useState<MachineRefundFilter>(() =>
    parseRefundFilter(searchParams.get('refund'))
  );
  const [activityFilter, setActivityFilter] = useState<MachineActivityFilter>(() =>
    parseActivityFilter(searchParams.get('activity'))
  );
  const [sort, setSort] = useState<MachineSort>(() => parseMachineSort(searchParams.get('sort')));
  const [visibleMachineLimit, setVisibleMachineLimit] = useState(() => {
    const parsed = Number(searchParams.get('limit'));
    return Number.isInteger(parsed) && parsed >= 20 ? parsed : 20;
  });
  const [taxDrafts, setTaxDrafts] = useState<Record<string, string>>({});
  const [savingTaxMachineId, setSavingTaxMachineId] = useState<string | null>(null);
  const [taxChangeForm, setTaxChangeForm] = useState(emptyTaxChangeForm);
  const [isTaxChangeDialogOpen, setIsTaxChangeDialogOpen] = useState(false);
  const taxTreatments = useQuery({
    queryKey: ['admin-reporting-tax-treatments', user?.id], queryFn: fetchReportingTaxTreatments,
    enabled: isTaxChangeDialogOpen, staleTime: 30000,
  });
  const [historyMachine, setHistoryMachine] = useState<PartnershipSetupMachine | null>(null);
  const [editingMachine, setEditingMachine] = useState<PartnershipSetupMachine | null>(null);
  const [isMachineDialogOpen, setIsMachineDialogOpen] = useState(() =>
    searchParams.get('edit') === 'machine' && !searchParams.get('machineId') && !routeMachineId
  );
  const [demoRefundManagerEmailsByMachineId, setDemoRefundManagerEmailsByMachineId] = useState<
    Record<string, string[]>
  >({});
  const [demoRefundReadinessByMachineId, setDemoRefundReadinessByMachineId] = useState<
    Record<string, DemoRefundReadiness>
  >({});
  const [isBulkActivatingRefunds, setIsBulkActivatingRefunds] = useState(false);

  const highlightedMachineId = searchParams.get('machineId');
  const selectedRowId = searchParams.get('selected');
  const isMachineEditorRequested = searchParams.get('edit') === 'machine';
  const isInventoryRoute = location.pathname.endsWith('/inventory');
  const isDetailRoute = Boolean(routeMachineId || routeSourceKey) && !isInventoryRoute;
  const isLocalDemoMode = isLocalUatDemoForced();
  const [completedSourceMachineId, setCompletedSourceMachineId] = useState<string | null>(null);
  const [completedSourceSetupVersion, setCompletedSourceSetupVersion] = useState(0);
  const importedInventory = useQuery({ queryKey: [...machineSourceInventoryQueryKey, user?.id], queryFn: fetchMachineSourceInventorySnapshot, enabled: !isLocalDemoMode, staleTime: 30000, retry: false });
  const selectedImportedSource = routeSourceKey
    ? importedInventory.data?.sources.find((source) => source.sourceKey === routeSourceKey && !source.archivedMapping) ?? null
    : null;
  const workspaceMetadata = useQuery({ queryKey: machineWorkspaceQueryKey, queryFn: fetchMachineWorkspaceMetadata, enabled: !isLocalDemoMode, staleTime: 30000 });
  const metadataById = useMemo(() => new Map((workspaceMetadata.data ?? []).map((item) => [item.machineId, item])), [workspaceMetadata.data]);
  const isMachineIdentityEditable = isSuperAdmin;
  const hasScopedMachineLimit = isScopedAdmin && !isSuperAdmin;
  const pendingSourceMachineId =
    searchParams.get('externalMachineId') ?? searchParams.get('sunzeMachineId');

  useLayoutEffect(() => {
    if (isDetailRoute) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [isDetailRoute, location.pathname]);

  useEffect(() => {
    if (isInventoryRoute || isDetailRoute) return;
    const scrollPosition = Number(searchParams.get('scroll'));
    if (!Number.isFinite(scrollPosition) || scrollPosition <= 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: scrollPosition, behavior: 'instant' }));
    return () => window.cancelAnimationFrame(frame);
  }, [isDetailRoute, isInventoryRoute, searchParams]);

  const {
    data: liveSetup = emptySetup,
    isLoading: liveIsLoading,
    isFetching: liveIsFetching,
    dataUpdatedAt: liveSetupUpdatedAt,
    error,
  } = useQuery({
    queryKey: setupQueryKey,
    queryFn: fetchPartnershipReportingSetup,
    enabled: !isLocalDemoMode,
    staleTime: 1000 * 30,
  });

  const {
    data: liveRefundManagerSetup = emptyRefundManagerSetup,
    isLoading: liveIsRefundManagerSetupLoading,
    dataUpdatedAt: liveRefundSetupUpdatedAt,
  } = useQuery({
    queryKey: refundManagerSetupQueryKey,
    queryFn: fetchRefundManagerSetup,
    enabled: !isLocalDemoMode,
    staleTime: 1000 * 30,
  });

  const {
    data: refundNayaxInventory,
    isLoading: isRefundNayaxInventoryLoading,
    error: refundNayaxInventoryError,
  } = useQuery({
    queryKey: refundNayaxInventoryQueryKey,
    queryFn: fetchRefundNayaxInventory,
    enabled: !isLocalDemoMode && (isInventoryRoute || isDetailRoute) && isSuperAdmin,
    staleTime: 1000 * 30,
  });

  const isLoading = isLocalDemoMode ? false : liveIsLoading;
  const isFetching = isLocalDemoMode ? false : liveIsFetching;
  const isRefundManagerSetupLoading = isLocalDemoMode ? false : liveIsRefundManagerSetupLoading;
  const setupUpdatedAt = isLocalDemoMode
    ? Date.now()
    : Math.max(liveSetupUpdatedAt, liveRefundSetupUpdatedAt);
  const setup = useMemo(
    () => (isLocalDemoMode ? buildLocalMachineManagerDemoSetup() : liveSetup),
    [isLocalDemoMode, liveSetup]
  );

  const refundManagerSetup = useMemo<RefundManagerSetup>(() => {
    if (!isLocalDemoMode) return liveRefundManagerSetup;

    return {
      standardLaunchLimitCents: null,
      globalRefunds: { available: true, paused: false, blockReason: null },
      machines: setup.machines.map((machine) => {
        const demoReadiness = demoRefundReadinessByMachineId[machine.id] ?? {
          refundIntakeEnabled: false,
          refundPublicDisplayLabel: null,
          nayaxMachineId: null,
          nayaxAccountKey: null,
        };

        return {
          id: machine.id,
          machineLabel: machine.machine_label,
          machineType: machine.machine_type,
          locationName: machine.location_name,
          refundIntakeEnabled: demoReadiness.refundIntakeEnabled,
          refundPublicDisplayLabel: demoReadiness.refundPublicDisplayLabel,
          nayaxLookupConfigured: Boolean(demoReadiness.nayaxMachineId),
          nayaxMachineId: demoReadiness.nayaxMachineId,
          nayaxAccountKey: demoReadiness.nayaxAccountKey,
          managerEmails: demoRefundManagerEmailsByMachineId[machine.id] ?? [],
          managerCount: (demoRefundManagerEmailsByMachineId[machine.id] ?? []).length,
          customerIntakeAccepting: true,
          transactionMatchingEnabled: demoReadiness.refundIntakeEnabled,
          transactionLookupReady: Boolean(demoReadiness.nayaxMachineId),
          managerRoutingReady: (demoRefundManagerEmailsByMachineId[machine.id] ?? []).length > 0,
          nayaxRefundsEnabled: false,
          nayaxRefundMaxAmountCents: null,
          paymentDisabledReason: 'awaiting_reviewed_activation' as const,
          activationEligible:
            demoReadiness.refundIntakeEnabled &&
            Boolean(demoReadiness.nayaxMachineId) &&
            (demoRefundManagerEmailsByMachineId[machine.id] ?? []).length > 0,
          readinessState:
            demoReadiness.refundIntakeEnabled &&
            Boolean(demoReadiness.nayaxMachineId) &&
            (demoRefundManagerEmailsByMachineId[machine.id] ?? []).length > 0
              ? 'ready_to_activate' as const
              : 'setup_needed' as const,
          readinessBlockReason: !demoReadiness.refundIntakeEnabled
            ? 'transaction_matching_off' as const
            : !demoReadiness.nayaxMachineId
              ? 'transaction_lookup_not_ready' as const
              : (demoRefundManagerEmailsByMachineId[machine.id] ?? []).length === 0
                ? 'manager_route_not_ready' as const
                : null,
        };
      }),
    };
  }, [
    demoRefundManagerEmailsByMachineId,
    demoRefundReadinessByMachineId,
    isLocalDemoMode,
    liveRefundManagerSetup,
    setup.machines,
  ]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: setupQueryKey }),
      queryClient.invalidateQueries({ queryKey: refundManagerSetupQueryKey }),
      queryClient.invalidateQueries({ queryKey: refundNayaxInventoryQueryKey }),
      queryClient.invalidateQueries({ queryKey: machineWorkspaceQueryKey }),
      queryClient.invalidateQueries({ queryKey: machineSourceInventoryQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['admin-machine-tax-source'] }),
    ]);
  };

  const saveDemoMachineManagers = async (machineId: string, managerEmails: string[]) => {
    setDemoRefundManagerEmailsByMachineId((current) => ({
      ...current,
      [machineId]: uniqueEmails(managerEmails),
    }));
  };

  const saveDemoRefundReadiness = async (machineId: string, readiness: DemoRefundReadiness) => {
    setDemoRefundReadinessByMachineId((current) => ({
      ...current,
      [machineId]: readiness,
    }));
  };

  const refundManagerSetupByMachineId = useMemo(
    () => new Map(refundManagerSetup.machines.map((machine) => [machine.id, machine])),
    [refundManagerSetup.machines]
  );

  const selectedMachineForEditor =
    (routeMachineId || selectedImportedSource?.reportingMachineId
      ? setup.machines.find((machine) => machine.id === (routeMachineId ?? selectedImportedSource?.reportingMachineId)) ?? null
      : editingMachine ? setup.machines.find((item) => item.id === editingMachine.id) ?? editingMachine : null) ??
    (highlightedMachineId
      ? setup.machines.find((machine) => machine.id === highlightedMachineId) ?? null
      : null);
  const isMachineEditorOpen = isMachineDialogOpen;

  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');
    setTaxFilter(parseTaxFilter(searchParams.get('tax')));
    setAssignmentFilter(parseAssignmentFilter(searchParams.get('assignment')));
    setMachineTypeFilter(parseMachineTypeFilter(searchParams.get('type')));
    setRefundFilter(parseRefundFilter(searchParams.get('refund')));
    setActivityFilter(parseActivityFilter(searchParams.get('activity')));
    setSort(parseMachineSort(searchParams.get('sort')));
    setView(parseMachineView(searchParams.get('view')));
    setCompanyFilter(searchParams.get('company') ?? 'all');
    const parsedLimit = Number(searchParams.get('limit'));
    setVisibleMachineLimit(Number.isInteger(parsedLimit) && parsedLimit >= 20 ? parsedLimit : 20);
  }, [searchParams]);

  useEffect(() => {
    if (isInventoryRoute || isDetailRoute) return;

    const externalMachineId = searchParams.get('externalMachineId') ?? searchParams.get('sunzeMachineId');
    if (externalMachineId) {
      navigate(`/admin/machines/inventory?${searchParams.toString()}`, { replace: true });
      return;
    }

    if (highlightedMachineId && isMachineEditorRequested) {
      const returnParams = new URLSearchParams(searchParams);
      returnParams.delete('machineId');
      returnParams.delete('edit');
      const returnValue = returnParams.toString();
      const detailParams = new URLSearchParams();
      if (returnValue) detailParams.set('return', returnValue);
      if (searchParams.get('demo') === 'on') detailParams.set('demo', 'on');
      navigate(
        `/admin/machines/${encodeURIComponent(highlightedMachineId)}${detailParams.size ? `?${detailParams.toString()}` : ''}`,
        { replace: true }
      );
    }
  }, [
    highlightedMachineId,
    isDetailRoute,
    isInventoryRoute,
    isMachineEditorRequested,
    navigate,
    searchParams,
  ]);

  const allMachineRows = useMemo(() => {
    const currentDate = today();

    return setup.machines
      .map((machine) => {
        const taxRate = getCurrentTaxRate(setup.taxRates, machine.id, currentDate);
        const taxStatus = getTaxStatus(taxRate);
        const activeAssignments = getActiveMachineAssignments(setup, machine.id, currentDate);
        const machineWarnings = setup.warnings.filter((warning) => warning.machineId === machine.id);
        const refundSetup = refundManagerSetupByMachineId.get(machine.id);
        const machineManagerEmails = uniqueEmails(
          refundSetup?.managerEmails ?? []
        );
        const refundReadinessState = refundSetup?.readinessState ?? 'setup_needed';
        const refundBlockReason = refundSetup?.readinessBlockReason ?? refundSetup?.paymentDisabledReason ?? null;
        const hasAssignmentOverlap =
          activeAssignments.length > 1 ||
          machineWarnings.some(
            (warning) => warning.warningType === 'overlapping_partnership_assignments'
          );
        const attentionReasons: MachineAttentionReason[] = [];
        const isSetupPhase = machine.operational_phase === 'setup';

        const providerBlocked = refundReadinessState === 'ready_to_refund' && (refundManagerSetup.globalRefunds.paused || !refundManagerSetup.globalRefunds.available);
        if (!isSetupPhase && (refundReadinessState !== 'ready_to_refund' || providerBlocked)) {
          const reasonLabel = providerBlocked
            ? refundManagerSetup.globalRefunds.paused ? 'Card refunds paused globally' : 'Direct API is unavailable'
            : refundReadinessState === 'ready_to_activate'
              ? 'Card refunds are ready to activate'
              : refundReasonLabel(refundBlockReason);
          const nextStep = providerBlocked
            ? 'Review global refund status'
            : refundBlockReason === 'manager_route_not_ready'
              ? 'Assign a Machine Manager'
              : refundBlockReason === 'transaction_lookup_not_ready'
                ? 'Review Nayax mapping'
                : refundReadinessState === 'ready_to_activate'
                  ? 'Review and activate card refunds'
                  : 'Review refund setup';
          attentionReasons.push({
            code: 'refund_readiness',
            label: reasonLabel,
            nextStep,
            tab: refundBlockReason === 'manager_route_not_ready' ? 'managers' : 'refunds',
          });
        }

        if (
          !isSetupPhase &&
          machineManagerEmails.length === 0 &&
          !attentionReasons.some((reason) => reason.tab === 'managers')
        ) {
          attentionReasons.push({
            code: 'manager_missing',
            label: 'No Machine Manager assigned',
            nextStep: 'Assign a Machine Manager',
            tab: 'managers',
          });
        }

        if (!isSetupPhase && hasAssignmentOverlap) {
          attentionReasons.push({
            code: 'report_overlap',
            label: 'Partner report assignments overlap',
            nextStep: 'Resolve the report overlap',
            tab: 'reporting',
          });
        }

        return {
          machine,
          taxRate,
          taxStatus,
          activeAssignments,
          machineWarnings,
          machineManagerEmails,
          refundIntakeEnabled: refundSetup?.refundIntakeEnabled ?? false,
          nayaxLookupConfigured: refundSetup?.nayaxLookupConfigured ?? false,
          refundReadinessState,
          refundCardEnabled: refundSetup?.nayaxRefundsEnabled ?? false,
          refundLimitCents: refundSetup?.nayaxRefundMaxAmountCents ?? null,
          refundBlockReason,
          draftValue: taxDrafts[machine.id] ?? (taxRate ? String(Number(taxRate.tax_rate_percent)) : ''),
          attentionReasons,
        };
      });
  }, [refundManagerSetupByMachineId, refundManagerSetup.globalRefunds.available, refundManagerSetup.globalRefunds.paused, setup, taxDrafts]);

  const machineRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return allMachineRows
      .filter((row) => {
        if (taxFilter === 'all') return true;
        if (taxFilter === 'missing') {
          return row.activeAssignments.length > 0 && row.taxStatus === 'missing';
        }
        return row.taxStatus === taxFilter;
      })
      .filter((row) => {
        if (assignmentFilter === 'all') return true;
        if (assignmentFilter === 'unassigned') return row.activeAssignments.length === 0;
        return (
          row.activeAssignments.length > 1 ||
          row.machineWarnings.some(
            (warning) => warning.warningType === 'overlapping_partnership_assignments'
          )
        );
      })
      .filter(
        (row) =>
          machineTypeFilter === 'all' ||
          normalizeMachineType(row.machine.machine_type) === machineTypeFilter
      )
      .filter((row) => {
        if (refundFilter === 'all') return true;
        if (refundFilter === 'paused') return refundManagerSetup.globalRefunds.paused;
        if (refundFilter === 'ready') {
          return row.refundReadinessState === 'ready_to_refund' && refundManagerSetup.globalRefunds.available;
        }
        if (refundFilter === 'direct_blocked') {
          return row.refundReadinessState === 'ready_to_refund' &&
            !refundManagerSetup.globalRefunds.available &&
            !refundManagerSetup.globalRefunds.paused;
        }
        return row.refundReadinessState !== 'ready_to_refund';
      })
      .filter((row) => {
        if (activityFilter === 'all') return true;
        const metadata = metadataById.get(row.machine.id);
        if (!metadata) return false;
        if (activityFilter === 'no_sales') return !metadata.lastRecordedTransaction;
        const age = transactionAge(metadata.lastRecordedTransaction);
        if (activityFilter === 'idle') return age !== null && age >= 30;
        return age !== null && age < 30;
      })
      .filter((row) => {
        if (!normalizedSearch) return true;
        return [
          row.machine.machine_label,
          row.machine.account_name,
          row.machine.sunze_machine_id ?? '',
          metadataById.get(row.machine.id)?.nayaxMachineId ?? '',
          metadataById.get(row.machine.id)?.nayaxAccountKey ?? '',
          metadataById.get(row.machine.id)?.sources.map((source) => `${source.platform} ${source.name} ${source.id}`).join(' ') ?? '',
          row.machineManagerEmails.join(' '),
          row.activeAssignments.map((assignment) => assignment.partnership_name).join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (sort === 'machine') return left.machine.machine_label.localeCompare(right.machine.machine_label);
        if (sort === 'latest_sale') {
          return (metadataById.get(right.machine.id)?.lastRecordedTransaction ?? '').localeCompare(metadataById.get(left.machine.id)?.lastRecordedTransaction ?? '');
        }
        if (sort === 'oldest') return (metadataById.get(left.machine.id)?.lastRecordedTransaction ?? '9999').localeCompare(metadataById.get(right.machine.id)?.lastRecordedTransaction ?? '9999');
        const attentionDifference = Number(right.attentionReasons.length > 0) - Number(left.attentionReasons.length > 0);
        if (attentionDifference !== 0) return attentionDifference;
        return left.machine.machine_label.localeCompare(right.machine.machine_label);
      });
  }, [activityFilter, allMachineRows, assignmentFilter, machineTypeFilter, refundFilter, refundManagerSetup.globalRefunds.available, refundManagerSetup.globalRefunds.paused, search, sort, taxFilter, metadataById]);

  // Source identities are the catalogue. Hub configuration is an optional exact join.
  const sourceRows = useMemo(() => {
    if (isLocalDemoMode) return machineRows.map((hubRow) => ({ source: demoSourceIdentity(hubRow.machine), hubRow }));
    if (importedInventory.isError) return [];
    const filteredHubIds = new Set(machineRows.map((row) => row.machine.id));
    const query = search.trim().toLowerCase();
    return (importedInventory.data?.sources ?? []).filter((source) => !source.archivedMapping).flatMap((source) => {
      const hubRow = allMachineRows.find((row) => row.machine.id === source.reportingMachineId) ?? null;
      const companyId = source.companyId ?? hubRow?.machine.account_id ?? null;
      if (companyFilter === 'unassigned' ? !!companyId : companyFilter !== 'all' && companyId !== companyFilter) return [];
      const sourceMatchesSearch = [source.platform, source.sourceName, source.sourceId, source.sourceAccountKey, source.machineName, source.nayaxName, source.nayaxMachineId, source.nayaxAccountKey].filter(Boolean).join(' ').toLowerCase().includes(query);
      if (source.reportingMachineId && hubRow && !filteredHubIds.has(source.reportingMachineId)) {
        // Original source identity remains searchable even if the Hub alias differs.
        if (!sourceMatchesSearch || machineTypeFilter !== 'all' || taxFilter !== 'all' || assignmentFilter !== 'all' || refundFilter !== 'all' || activityFilter !== 'all') return [];
      }
      if (!hubRow) {
        if (query && !sourceMatchesSearch) return [];
        if (machineTypeFilter !== 'all' && machineTypeFilter !== (source.platform === 'Kexiaozhan' ? 'snapcase' : 'commercial')) return [];
        if (assignmentFilter === 'overlap' || (taxFilter !== 'all' && taxFilter !== 'missing') || ['ready', 'direct_blocked'].includes(refundFilter) || ['recent', 'idle'].includes(activityFilter)) return [];
      }
      return [{ source, hubRow }];
    }).sort((a, b) => {
      if (sort === 'oldest' || sort === 'latest_sale') {
        const left = a.hubRow ? metadataById.get(a.hubRow.machine.id)?.lastRecordedTransaction : null;
        const right = b.hubRow ? metadataById.get(b.hubRow.machine.id)?.lastRecordedTransaction : null;
        return sort === 'oldest' ? (left ?? '9999').localeCompare(right ?? '9999') : (right ?? '').localeCompare(left ?? '');
      }
      return (a.hubRow?.machine.machine_label ?? a.source.sourceName ?? a.source.sourceId).localeCompare(b.hubRow?.machine.machine_label ?? b.source.sourceName ?? b.source.sourceId);
    });
  }, [isLocalDemoMode, machineRows, importedInventory.data, importedInventory.isError, allMachineRows, search, companyFilter, machineTypeFilter, taxFilter, assignmentFilter, refundFilter, activityFilter, sort, metadataById]);
  const sourceViewMatches = (item: { hubRow: MachineSetupRowViewModel | null; source: MachineSourceInventoryItem }, selectedView: MachineView) => {
    if (selectedView === 'inactive') return !!item.source.catalogueInactiveAt;
    if (item.source.catalogueInactiveAt) return false;
    if (selectedView === 'review') return !item.source.reportingMachineId || item.source.mappingConflict;
    if (selectedView === 'setup') return !!item.source.salesActivationPending || !item.hubRow || item.hubRow.machine.operational_phase === 'setup' || item.hubRow.attentionReasons.length > 0;
    if (selectedView === 'attention') return !!item.source.salesActivationPending || !item.hubRow || item.hubRow.attentionReasons.length > 0;
    if (selectedView === 'ready') return !item.source.salesActivationPending && !!item.hubRow && item.hubRow.machine.operational_phase !== 'setup' && item.hubRow.attentionReasons.length === 0;
    return true;
  };
  const visibleSourceRows = sourceRows.filter((item) => sourceViewMatches(item, view));
  const renderedSourceRows = visibleSourceRows.slice(0, visibleMachineLimit);
  const selectedViewMachineCount = visibleSourceRows.length;
  const sourceVerificationIncomplete = !isLocalDemoMode && importedInventory.isError;
  const portfolioCounts = {
    all: sourceRows.filter((item) => sourceViewMatches(item, 'all')).length,
    inactive: sourceRows.filter((item) => sourceViewMatches(item, 'inactive')).length,
    review: sourceRows.filter((item) => sourceViewMatches(item, 'review')).length,
    setup: sourceRows.filter((item) => sourceViewMatches(item, 'setup')).length,
    attention: sourceRows.filter((item) => sourceViewMatches(item, 'attention')).length,
    ready: sourceRows.filter((item) => sourceViewMatches(item, 'ready')).length,
  };

  const catalogueCompanies = [...new Map((importedInventory.data?.sources ?? []).filter((source) => source.companyId)
    .map((source) => [source.companyId!, source.companyName || 'Unnamed company'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));

  useEffect(() => {
    if (!completedSourceMachineId || !selectedImportedSource || setupUpdatedAt <= completedSourceSetupVersion) return;
    const source = importedInventory.data?.sources.find((item) => item.sourceKey === selectedImportedSource.sourceKey);
    if (importedInventory.isError || source?.reportingMachineId !== completedSourceMachineId) return;
    const machine = setup.machines.find((item) => item.id === completedSourceMachineId);
    if (selectedImportedSource.platform === 'Sunze' && machine?.sunze_machine_id !== selectedImportedSource.sourceId) return;
    if (machine) {
      setCompletedSourceMachineId(null);
      // Keep the exact source URL and list return context after its verified Hub join loads.
    }
  }, [completedSourceMachineId, completedSourceSetupVersion, selectedImportedSource, setupUpdatedAt, setup.machines, importedInventory.data, importedInventory.isError]);

  const updateView = (nextView: MachineView) => {
    setView(nextView);
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === 'all') nextParams.delete('view');
    else nextParams.set('view', nextView);
    setSearchParams(nextParams, { replace: true });
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) nextParams.set('q', value);
    else nextParams.delete('q');
    setSearchParams(nextParams, { replace: true });
  };

  const clearFilters = () => {
    setCompanyFilter('all');
    setTaxFilter('all');
    setAssignmentFilter('all');
    setMachineTypeFilter('all');
    setRefundFilter('all');
    setActivityFilter('all');
    setSort('status');
    setVisibleMachineLimit(20);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('tax');
    nextParams.delete('company');
    nextParams.delete('assignment');
    nextParams.delete('type');
    nextParams.delete('refund');
    nextParams.delete('activity');
    nextParams.delete('sort');
    nextParams.delete('limit');
    setSearchParams(nextParams, { replace: true });
  };

  const clearSearchAndFilters = () => {
    setCompanyFilter('all');
    setSearch('');
    setTaxFilter('all');
    setAssignmentFilter('all');
    setMachineTypeFilter('all');
    setRefundFilter('all');
    setActivityFilter('all');
    setSort('status');
    setVisibleMachineLimit(20);
    const nextParams = new URLSearchParams(searchParams);
    ['q', 'company', 'tax', 'assignment', 'type', 'refund', 'activity', 'sort', 'limit'].forEach((key) =>
      nextParams.delete(key)
    );
    setSearchParams(nextParams, { replace: true });
  };

  const updateTaxFilter = (nextFilter: MachineTaxFilter) => {
    setTaxFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      nextParams.delete('tax');
    } else {
      nextParams.set('tax', nextFilter);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const updateAssignmentFilter = (nextFilter: MachineAssignmentFilter) => {
    setAssignmentFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      nextParams.delete('assignment');
    } else {
      nextParams.set('assignment', nextFilter);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const openCreateMachine = () => {
    if (!isMachineIdentityEditable) {
      toast.error('Only Super Admins can create machine records.');
      return;
    }

    setEditingMachine(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('machineId');
    nextParams.delete('sunzeMachineId');
    nextParams.delete('sunzeMachineName');
    nextParams.delete('externalMachineId');
    nextParams.delete('externalMachineName');
    nextParams.set('edit', 'machine');
    setSearchParams(nextParams, { replace: true });
    setIsMachineDialogOpen(true);
  };

  const openEditMachine = (machine: PartnershipSetupMachine, tab: MachineDetailTab = 'overview') => {
    const returnParams = new URLSearchParams(searchParams);
    returnParams.set('selected', machine.id);
    returnParams.set('scroll', String(Math.round(window.scrollY)));
    const detailParams = new URLSearchParams();
    if (returnParams.size) detailParams.set('return', returnParams.toString());
    if (tab !== 'overview') detailParams.set('tab', tab);
    if (searchParams.get('demo') === 'on') detailParams.set('demo', 'on');
    navigate(
      `/admin/machines/${encodeURIComponent(machine.id)}${detailParams.toString() ? `?${detailParams.toString()}` : ''}`
    );
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const openImportedSource = (source: MachineSourceInventoryItem) => {
    const returnParams = new URLSearchParams(searchParams);
    returnParams.set('selected', source.reportingMachineId ?? source.sourceKey);
    returnParams.set('scroll', String(Math.round(window.scrollY)));
    const detailParams = new URLSearchParams({ return: returnParams.toString() });
    navigate(`/admin/machines/source/${encodeURIComponent(source.sourceKey)}?${detailParams}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const closeMachineDialog = (open: boolean) => {
    setIsMachineDialogOpen(open);
    if (!open) {
      setEditingMachine(null);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('machineId');
      nextParams.delete('sunzeMachineId');
      nextParams.delete('sunzeMachineName');
      nextParams.delete('externalMachineId');
      nextParams.delete('externalMachineName');
      nextParams.delete('edit');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const detailTab = parseMachineDetailTab(searchParams.get('tab'));
  const returnQuery = searchParams.get('return');
  const machinesReturnHref = returnQuery ? `/admin/machines?${returnQuery}` : '/admin/machines';

  const updateDetailTab = (nextTab: MachineDetailTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === 'overview') nextParams.delete('tab');
    else nextParams.set('tab', nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  const updateMachineTypeFilter = (nextFilter: MachineTypeFilter) => {
    setMachineTypeFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') nextParams.delete('type');
    else nextParams.set('type', nextFilter);
    setSearchParams(nextParams, { replace: true });
  };

  const updateRefundFilter = (nextFilter: MachineRefundFilter) => {
    setRefundFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') nextParams.delete('refund');
    else nextParams.set('refund', nextFilter);
    setSearchParams(nextParams, { replace: true });
  };

  const updateActivityFilter = (nextFilter: MachineActivityFilter) => {
    setActivityFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') nextParams.delete('activity');
    else nextParams.set('activity', nextFilter);
    setSearchParams(nextParams, { replace: true });
  };

  const updateSort = (nextSort: MachineSort) => {
    setSort(nextSort);
    const nextParams = new URLSearchParams(searchParams);
    if (nextSort === 'status') nextParams.delete('sort');
    else nextParams.set('sort', nextSort);
    setSearchParams(nextParams, { replace: true });
  };

  const loadMoreMachines = () => {
    const nextLimit = Math.min(visibleMachineLimit + 20, visibleSourceRows.length);
    setVisibleMachineLimit(nextLimit);
    const nextParams = new URLSearchParams(searchParams);
    if (nextLimit <= 20) nextParams.delete('limit');
    else nextParams.set('limit', String(nextLimit));
    setSearchParams(nextParams, { replace: true });
  };

  const openTaxChangeDialog = (machine: PartnershipSetupMachine, taxRate?: ReportingMachineTaxRate) => {
    if (isLocalDemoMode) {
      toast.info('Demo mode is visual only. Use seeded functional UAT to save reporting tax changes.');
      return;
    }

    setTaxChangeForm({
      machineId: machine.id,
      taxRatePercent: taxRate ? String(Number(taxRate.tax_rate_percent)) : '',
      effectiveStartDate: taxRate ? today() : initialReportingTaxStartDate,
      reason: '',
      cardTreatment: null,
      cashTreatment: null,
    });
    setIsTaxChangeDialogOpen(true);
  };

  const closeTaxChangeDialog = (open: boolean) => {
    setIsTaxChangeDialogOpen(open);
    if (!open) {
      setTaxChangeForm(emptyTaxChangeForm);
    }
  };

  const taxHistoryRates = useMemo(
    () =>
      historyMachine
        ? setup.taxRates
            .filter((taxRate) => taxRate.machine_id === historyMachine.id)
            .sort((left, right) => right.effective_start_date.localeCompare(left.effective_start_date))
        : [],
    [historyMachine, setup.taxRates]
  );

  const saveTaxRate = async (
    machine: PartnershipSetupMachine,
    taxRate: ReportingMachineTaxRate | undefined,
    draftValue: string
  ) => {
    const parsedRate = Number(draftValue);

    if (isLocalDemoMode) {
      toast.info('Demo mode is visual only. Use seeded functional UAT to save reporting tax changes.');
      return;
    }

    if (!draftValue.trim() || Number.isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      toast.error('Enter a tax rate from 0 to 100. Use 0 for explicit no-tax machines.');
      return;
    }

    setSavingTaxMachineId(machine.id);
    try {
      await setReportingMachineTaxRateAdmin({
        machineId: machine.id,
        taxRatePercent: parsedRate,
        effectiveStartDate: taxRate?.effective_start_date ?? initialReportingTaxStartDate,
        reason: taxRate
          ? 'Reporting tax rate updated from Machines admin'
          : 'Initial reporting tax rate documented from Machines admin',
      });
      toast.success(`${machine.machine_label} tax rate updated.`);
      setTaxDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[machine.id];
        return nextDrafts;
      });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine tax rate.');
    } finally {
      setSavingTaxMachineId(null);
    }
  };

  const saveTaxChange = async () => {
    const machine = setup.machines.find((candidate) => candidate.id === taxChangeForm.machineId);
    const parsedRate = Number(taxChangeForm.taxRatePercent);

    if (isLocalDemoMode) {
      toast.info('Demo mode is visual only. Use seeded functional UAT to save reporting tax changes.');
      return;
    }

    if (!machine) {
      toast.error('Select a machine before recording a tax change.');
      return;
    }

    if (
      !taxChangeForm.taxRatePercent.trim() ||
      Number.isNaN(parsedRate) ||
      parsedRate < 0 ||
      parsedRate > 100
    ) {
      toast.error('Enter a tax rate from 0 to 100. Use 0 for explicit no-tax machines.');
      return;
    }

    if (!taxChangeForm.effectiveStartDate) {
      toast.error('Choose when the new reporting tax rate applies from.');
      return;
    }

    if (taxChangeForm.reason.trim().length < 8) {
      toast.error('Add a short reason for the reporting tax change.');
      return;
    }

    const changingTreatment = Boolean(taxChangeForm.cardTreatment || taxChangeForm.cashTreatment);
    if (changingTreatment && !taxTreatments.isSuccess) {
      toast.error('Reload the saved treatment before saving treatment changes.');
      return;
    }
    const treatmentFor = (tender: ReportingTaxTender) => {
      const draft = tender === 'card' ? taxChangeForm.cardTreatment : taxChangeForm.cashTreatment;
      return draft ? { amountBasis: draft.amountBasis, taxablePortionPercent: Number(draft.taxablePortionPercent) }
        : getEffectiveReportingTaxTreatment(taxTreatments.data ?? [], machine.id, tender, taxChangeForm.effectiveStartDate);
    };
    if ([taxChangeForm.cardTreatment, taxChangeForm.cashTreatment].some(draft => draft && (!draft.taxablePortionPercent.trim() || !Number.isFinite(Number(draft.taxablePortionPercent)) || Number(draft.taxablePortionPercent) < 0 || Number(draft.taxablePortionPercent) > 100))) {
      toast.error('Enter each taxable portion from 0 to 100.');
      return;
    }

    setSavingTaxMachineId(machine.id);
    try {
      const configuration = {
        machineId: machine.id,
        taxRatePercent: parsedRate,
        effectiveStartDate: taxChangeForm.effectiveStartDate,
        reason: taxChangeForm.reason.trim(),
      };
      if (changingTreatment) {
        await saveReportingTaxConfiguration({ ...configuration, card: treatmentFor('card'), cash: treatmentFor('cash') });
        await queryClient.invalidateQueries({ queryKey: ['admin-reporting-tax-treatments'] });
      } else {
        await setReportingMachineTaxRateAdmin(configuration);
      }
      toast.success(`${machine.machine_label} tax change recorded.`);
      closeTaxChangeDialog(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record tax change.');
    } finally {
      setSavingTaxMachineId(null);
    }
  };

  const activateQualifiedRefundMachines = async () => {
    if (!window.confirm('Activate the card-refund capability for every qualified machine? Direct API availability is controlled separately, and approved pause exceptions will remain off.')) return;
    setIsBulkActivatingRefunds(true);
    try {
      const result = await activateQualifiedRefundMachinesAdmin(
        'Reviewed bulk activation from Admin Machines'
      );
      toast.success(
        result.activatedCount === 0
          ? 'No qualified machine capabilities needed activation.'
          : `${result.activatedCount} qualified machine ${result.activatedCount === 1 ? 'capability' : 'capabilities'} activated. Direct API availability is controlled separately.`
      );
      if (result.approvedExceptionCount > 0) {
        toast.info(`${result.approvedExceptionCount} approved pause ${result.approvedExceptionCount === 1 ? 'exception remains' : 'exceptions remain'} off.`);
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to activate qualified machine capabilities.');
    } finally {
      setIsBulkActivatingRefunds(false);
    }
  };

  if (isInventoryRoute) {
    const machinesHref = isLocalDemoMode ? '/admin/machines?demo=on' : '/admin/machines';
    const eligibleActivationCount = refundManagerSetup.machines.filter(
      (machine) => machine.activationEligible && !machine.nayaxRefundsEnabled
    ).length;
    return (
      <AppLayout>
        <section className="section-padding">
          <div className="container-page max-w-6xl">
            <Link
              to={machinesHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" />
              Machines
            </Link>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <ServerCog className="h-4 w-4" />
                  Provider reconciliation
                </div>
                <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Nayax readers</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Review only the inventory records that need a mapping, classification, or sync decision.
                </p>
              </div>
              <Button variant="outline" onClick={refresh} disabled={isFetching}>
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>

            {!isSuperAdmin ? (
              <div className="mt-8 rounded-xl border border-border bg-card px-5 py-8 text-center">
                <CircleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
                <h2 className="mt-3 font-semibold text-foreground">Nayax reader administration is limited to Super Admins</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                  Your granted machines still show the provider readiness that matters to your work.
                </p>
                <Button asChild variant="outline" className="mt-5">
                  <Link to={machinesHref}>Return to Machines</Link>
                </Button>
              </div>
            ) : (
              <RefundNayaxInventoryPanel
                inventory={isLocalDemoMode ? demoRefundNayaxInventory : refundNayaxInventory ?? null}
                machines={setup.machines}
                isLoading={isLocalDemoMode ? false : isRefundNayaxInventoryLoading}
                error={isLocalDemoMode ? null : refundNayaxInventoryError}
                canReconcile={!isLocalDemoMode && isSuperAdmin}
                canBulkActivate={!isLocalDemoMode && isSuperAdmin}
                isBulkActivating={isBulkActivatingRefunds}
                eligibleActivationCount={eligibleActivationCount}
                onBulkActivate={activateQualifiedRefundMachines}
                onSaved={refresh}
                focusedInventoryId={pendingSourceMachineId}
              />
            )}
          </div>
        </section>
      </AppLayout>
    );
  }

  if (isDetailRoute) {
    const detailRow = allMachineRows.find((row) => row.machine.id === selectedMachineForEditor?.id) ?? null;

    return (
      <AppLayout>
        <section className="px-4 py-5 sm:px-6 sm:py-16 lg:px-8 lg:py-24">
          <div className="container-page max-w-6xl">
            {isLoading || (routeSourceKey && importedInventory.isPending) ? (
              <div className="space-y-4" aria-label="Loading machine detail">
                <div className="h-11 w-40 animate-pulse rounded-md bg-muted" />
                <div className="h-28 animate-pulse rounded-xl bg-muted" />
                <div className="h-80 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : (error || (routeSourceKey && importedInventory.isError)) && !isLocalDemoMode ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-10 text-center">
                <CircleAlert className="mx-auto h-7 w-7 text-destructive" />
                <h1 className="mt-3 text-xl font-semibold text-foreground">Machine details could not load</h1>
                <p className="mt-2 text-sm text-muted-foreground">Your machine is still here. Try loading its details again.</p>
                <Button variant="outline" className="mt-5" onClick={() => void refresh()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry
                </Button>
              </div>
            ) : (!selectedMachineForEditor || !detailRow) && !selectedImportedSource ? (
              <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
                <CircleAlert className="mx-auto h-7 w-7 text-muted-foreground" />
                <h1 className="mt-3 text-xl font-semibold text-foreground">Machine not found</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  It may be outside your current machine grant or no longer active.
                </p>
                <Button asChild variant="outline" className="mt-5">
                  <Link to={machinesReturnHref}>Return to Machines</Link>
                </Button>
              </div>
            ) : (
              <MachineDialog
                open
                mode="page"
                activeTab={detailTab}
                onTabChange={updateDetailTab}
                backHref={machinesReturnHref}
                onOpenChange={(open) => !open && navigate(machinesReturnHref)}
                machine={selectedMachineForEditor}
                importedSource={selectedMachineForEditor ? null : selectedImportedSource}
                onImportedSourceSaved={(id) => { setCompletedSourceSetupVersion(setupUpdatedAt); setCompletedSourceMachineId(id); }}
                committedImportedMachineId={completedSourceMachineId}
                machineRow={detailRow}
                machines={setup.machines}
                refundManagerSetup={selectedMachineForEditor ? refundManagerSetupByMachineId.get(selectedMachineForEditor.id) ?? null : null}
                refundInventory={refundNayaxInventory ?? null}
                isRefundInventoryLoading={isRefundNayaxInventoryLoading}
                refundInventoryError={refundNayaxInventoryError}
                isRefundManagerSetupLoading={isRefundManagerSetupLoading}
                isLocalDemoMode={isLocalDemoMode}
                canEditMachineIdentity={isMachineIdentityEditable}
                canManageReportingTax={isSuperAdmin || isScopedAdmin}
                canActivateCardRefunds={!isLocalDemoMode && isSuperAdmin}
                globalRefunds={refundManagerSetup.globalRefunds}
                demoManagerAccounts={demoMachineManagerAccounts}
                onDemoMachineManagersSaved={saveDemoMachineManagers}
                onDemoRefundReadinessSaved={saveDemoRefundReadiness}
                onOpenTaxChange={openTaxChangeDialog}
                onShowTaxHistory={setHistoryMachine}
                taxHistoryCount={setup.taxRates.filter((rate) => rate.machine_id === selectedMachineForEditor?.id).length}
                onSaved={refresh}
              />
            )}
          </div>
        </section>
        <TaxChangeDialog
          open={isTaxChangeDialogOpen}
          onOpenChange={closeTaxChangeDialog}
          form={taxChangeForm}
          setForm={setTaxChangeForm}
          machine={setup.machines.find((machine) => machine.id === taxChangeForm.machineId) ?? null}
          isInitialSetup={!setup.taxRates.some((rate) => rate.machine_id === taxChangeForm.machineId)}
          isSaving={Boolean(taxChangeForm.machineId && savingTaxMachineId === taxChangeForm.machineId)}
          onSave={saveTaxChange}
          treatments={taxTreatments}
        />
        <TaxHistorySheet
          machine={historyMachine}
          rates={taxHistoryRates}
          onOpenChange={(open) => !open && setHistoryMachine(null)}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <section className="px-4 py-5 sm:px-6 sm:py-16 lg:px-8 lg:py-24">
        <div className="container-page">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
            <div>
              <h1 className="sr-only">Machines</h1>
              <p className="hidden max-w-2xl text-base font-medium leading-6 text-foreground sm:block">
                Find a machine, check readiness, and manage setup.
              </p>
              <p className="mt-1 text-xs text-muted-foreground" title={setupUpdatedAt ? new Date(setupUpdatedAt).toISOString() : undefined}>
                {setupUpdatedAt ? formatUpdatedAt(setupUpdatedAt) : 'Waiting for the latest update'}
              </p>
              {hasScopedMachineLimit && (
                <Badge className="mt-3" variant="outline">
                  Scoped Admin
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" className="min-h-11" onClick={refresh} disabled={isFetching}>
                {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              {isSuperAdmin && (
                <CompanyManagementSheet disabled={isLocalDemoMode} />
              )}
              {isSuperAdmin && (
                <Button asChild variant="ghost" className="min-h-11 text-muted-foreground">
                  <Link to={`/admin/machines/inventory${isLocalDemoMode ? '?demo=on' : ''}`}>
                    <ServerCog className="mr-2 h-4 w-4" />
                    Nayax readers
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {error && !isLocalDemoMode && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span>Unable to load the machine portfolio. Your records have not been removed.</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          )}

          {isLocalDemoMode && (
            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
              DEMO DATA - visual review only. Machine Manager changes save in this browser only
              and do not write to Supabase. Use seeded functional UAT to prove real persistence.
            </div>
          )}

          <nav
            aria-label="Machine views"
            className="mt-3 flex w-full gap-1 overflow-x-auto border-b border-border sm:mt-7"
          >
            {([
              ['all', 'Machines', portfolioCounts.all],
              ['setup', 'Setup needed', portfolioCounts.setup],
              ['ready', 'Ready', portfolioCounts.ready],
              ['inactive', 'Inactive', portfolioCounts.inactive],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => updateView(value)}
                aria-current={view === value ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  view === value && 'text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                )}
              >
                {label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-5 rounded-xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur lg:sticky lg:top-16 lg:z-20 supports-[backdrop-filter]:bg-background/90">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 lg:flex lg:items-end">
              <div className="col-span-2 min-w-0 lg:w-64">
                <Label htmlFor="machine-company-filter">Company</Label>
                <select id="machine-company-filter" value={companyFilter} className="mt-1 h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                  onChange={(event) => { const value = event.target.value; setCompanyFilter(value); const params = new URLSearchParams(searchParams); if (value === 'all') params.delete('company'); else params.set('company', value); setSearchParams(params, { replace: true }); }}>
                  <option value="all">All companies</option><option value="unassigned">Not assigned</option>
                  {catalogueCompanies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <Label htmlFor="machine-search" className="sr-only">Search machines</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="machine-search"
                    className="h-11 pl-9 text-base md:text-base"
                    value={search}
                    onChange={(event) => updateSearch(event.target.value)}
                    placeholder="Search machines"
                  />
                </div>
              </div>
              <details className="group relative min-w-0">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <Filter className="h-4 w-4" />
                  Filters
                  {(taxFilter !== 'all' || assignmentFilter !== 'all' || machineTypeFilter !== 'all' || refundFilter !== 'all' || activityFilter !== 'all') && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      {Number(taxFilter !== 'all') + Number(assignmentFilter !== 'all') + Number(machineTypeFilter !== 'all') + Number(refundFilter !== 'all') + Number(activityFilter !== 'all')}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 z-30 mt-2 grid w-[calc(100vw-4rem)] max-w-[38rem] gap-4 rounded-xl border border-border bg-popover p-4 shadow-lg lg:w-[38rem] lg:grid-cols-2">
                  <div>
                    <Label htmlFor="machine-type-filter">Machine type</Label>
                    <select
                      id="machine-type-filter"
                      value={machineTypeFilter}
                      onChange={(event) => updateMachineTypeFilter(event.target.value as MachineTypeFilter)}
                      className="mt-1 h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="all">All machine types</option>
                      {machineTypes.map((type) => <option key={type} value={type}>{formatMachineType(type)}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="refund-filter">Refund readiness</Label>
                    <select
                      id="refund-filter"
                      value={refundFilter}
                      onChange={(event) => updateRefundFilter(event.target.value as MachineRefundFilter)}
                      className="mt-1 h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="all">All refund states</option>
                      <option value="ready">Ready</option>
                      <option value="direct_blocked">Direct API blocked</option>
                      <option value="setup">Setup needed</option>
                      <option value="paused">Paused</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="assignment-filter">Partner reporting</Label>
                    <select
                      id="assignment-filter"
                      value={assignmentFilter}
                      onChange={(event) => updateAssignmentFilter(event.target.value as MachineAssignmentFilter)}
                      className="mt-1 h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="all">All reporting states</option>
                      <option value="unassigned">Not in partner reports</option>
                      <option value="overlap">Assignment overlaps</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="activity-filter">Activity</Label>
                    <select
                      id="activity-filter"
                      value={activityFilter}
                      onChange={(event) => updateActivityFilter(event.target.value as MachineActivityFilter)}
                      className="mt-1 h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="all">All activity</option>
                      <option value="recent">Recorded transaction in the last 30 days</option>
                      <option value="idle">Last recorded transaction &gt;30 days</option>
                      <option value="no_sales">No transactions recorded</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="machine-sort">Sort</Label>
                    <select
                      id="machine-sort"
                      value={sort}
                      onChange={(event) => updateSort(event.target.value as MachineSort)}
                      className="mt-1 h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="status">Needs attention first</option>
                      <option value="machine">Machine name</option>
                      <option value="latest_sale">Latest activity</option>
                      <option value="oldest">Oldest recorded transaction first</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button type="button" variant="ghost" onClick={clearFilters} className="w-full">
                      Clear filters
                    </Button>
                  </div>
                </div>
              </details>
            </div>
          </div>

          {(taxFilter !== 'all' || assignmentFilter !== 'all' || machineTypeFilter !== 'all' || refundFilter !== 'all' || activityFilter !== 'all') && (
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
              {machineTypeFilter !== 'all' && <ActiveFilterChip label={`Type: ${formatMachineType(machineTypeFilter)}`} onRemove={() => updateMachineTypeFilter('all')} />}
              {refundFilter !== 'all' && <ActiveFilterChip label={`Refunds: ${formatLabel(refundFilter)}`} onRemove={() => updateRefundFilter('all')} />}
              {activityFilter !== 'all' && <ActiveFilterChip label={`Activity: ${activityFilter === 'recent' ? 'Recent sale' : 'No sales'}`} onRemove={() => updateActivityFilter('all')} />}
              {taxFilter !== 'all' && <ActiveFilterChip label={`Tax: ${formatLabel(taxFilter)}`} onRemove={() => updateTaxFilter('all')} />}
              {assignmentFilter !== 'all' && <ActiveFilterChip label={`Reporting: ${formatLabel(assignmentFilter)}`} onRemove={() => updateAssignmentFilter('all')} />}
              <Button type="button" variant="ghost" className="min-h-11" onClick={clearFilters}>Clear all</Button>
            </div>
          )}

          {isSuperAdmin && importedInventory.data && (!importedInventory.data.importHealth?.verified || importFreshnessLabel(importedInventory.data.importHealth?.observedAt ?? null) !== 'Recent import') && <div className="mt-3 flex items-center justify-between gap-2 text-xs text-amber-800" aria-label="Import coverage warning"><span>Sunze import coverage needs review. Previously imported machines remain listed.</span><MachineHelp label="About import coverage">The latest import has not proved that every provider machine was covered. This warning never removes historical source records.{importedInventory.data.importHealth?.observedAt ? ` Latest import attempt: ${formatDate(importedInventory.data.importHealth.observedAt)}.` : ' Import history is unavailable.'}</MachineHelp></div>}

          {sourceVerificationIncomplete && (
            <div role="alert" className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p>Imported machine inventory could not load. The list is unavailable until the source records can be verified.</p>
              <Button variant="outline" className="mt-3 min-h-11" onClick={() => void importedInventory.refetch()}>Retry imported machines</Button>
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <div>
                <h2 className="font-semibold text-foreground">
                  {view === 'inactive' ? 'Inactive machines' : view === 'review' ? 'Imported machines awaiting source setup' : view === 'attention' ? 'Machines needing attention' : view === 'ready' ? 'Ready machines' : 'All imported machines'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {!isLocalDemoMode && importedInventory.isPending ? 'Loading imported machines…' : visibleSourceRows.length === selectedViewMachineCount
                    ? `${selectedViewMachineCount} ${selectedViewMachineCount === 1 ? 'machine' : 'machines'}`
                    : `${visibleSourceRows.length} of ${selectedViewMachineCount} machines`}
                </p>
              </div>
              {view === 'attention' && visibleSourceRows.length > 0 && (
                <Badge variant="outline" className="gap-1.5 border-amber-300 bg-amber-50 text-amber-900">
                  <CircleAlert className="h-3.5 w-3.5" />
                  Action required
                </Badge>
              )}
            </div>

            {isLoading || (!isLocalDemoMode && importedInventory.isPending) ? (
              <div className="space-y-px bg-border" aria-label="Loading machines">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-24 animate-pulse bg-background p-4">
                    <div className="h-4 w-40 rounded bg-muted" />
                    <div className="mt-3 h-3 w-64 max-w-full rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : visibleSourceRows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="mx-auto h-7 w-7 text-muted-foreground" />
                <h3 className="mt-3 font-semibold text-foreground">
                  {sourceVerificationIncomplete ? 'Source verification incomplete' : view === 'attention' ? 'No machines need attention' : 'No machines found'}
                </h3>
                <p className="mx-auto mt-2 max-w-md leading-6">
                {sourceVerificationIncomplete ? 'Retry loading imported machines. No historical Hub records are substituted for missing source data.' : hasScopedMachineLimit && setup.machines.length === 0
                  ? 'No machines are assigned to your scoped admin grant yet.'
                    : view === 'attention'
                      ? 'The machines in this view are ready for their current workflows.'
                      : 'Try a different search or clear the active filters.'}
                </p>
                {(search || companyFilter !== 'all' || taxFilter !== 'all' || assignmentFilter !== 'all' || machineTypeFilter !== 'all' || refundFilter !== 'all' || activityFilter !== 'all') && (
                  <Button
                    variant="outline"
                    className="mt-5"
                    onClick={clearSearchAndFilters}
                  >
                    Clear search and filters
                  </Button>
                )}
              </div>
            ) : (
              <div role="table" aria-label="Machines">
                <div
                  role="row"
                  className="hidden border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:gap-4"
                >
                  <div role="columnheader">Source machine</div>
                  <div role="columnheader">Nayax match</div>
                  <div role="columnheader">Company</div>
                  <div role="columnheader">Managers</div>
                  <div role="columnheader">Last recorded transaction</div>
                  <div role="columnheader" className="text-right">Manage</div>
                </div>
                <div role="rowgroup" className="divide-y divide-border bg-background">
                  {renderedSourceRows.map(({ source, hubRow }) => hubRow ? (
                    <MachinePortfolioRow key={source.sourceKey} row={hubRow} source={source}
                      metadata={metadataById.get(hubRow.machine.id)}
                      isHighlighted={[highlightedMachineId, selectedRowId].includes(hubRow.machine.id)}
                      onEdit={openEditMachine} globalRefunds={refundManagerSetup.globalRefunds} refundSetup={refundManagerSetupByMachineId.get(hubRow.machine.id) ?? null}/>
                  ) : <ImportedSourcePortfolioRow key={source.sourceKey} source={source} canSetup={isSuperAdmin}
                    onSetup={() => openImportedSource(source)}/>)}
                </div>
                {renderedSourceRows.length < visibleSourceRows.length && (
                  <div className="border-t border-border p-4 text-center">
                    <Button variant="outline" className="min-h-11" onClick={loadMoreMachines}>
                      Load 20 more
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing {renderedSourceRows.length} of {visibleSourceRows.length} machines
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>


      <MachineDialog
        open={isMachineEditorOpen}
        onOpenChange={closeMachineDialog}
        machine={selectedMachineForEditor}
        machineRow={allMachineRows.find((row) => row.machine.id === selectedMachineForEditor?.id)}
        machines={setup.machines}
        refundManagerSetup={
          selectedMachineForEditor
            ? refundManagerSetupByMachineId.get(selectedMachineForEditor.id) ?? null
            : null
        }
        isRefundManagerSetupLoading={isRefundManagerSetupLoading}
        isLocalDemoMode={isLocalDemoMode}
        canEditMachineIdentity={isMachineIdentityEditable}
        canManageReportingTax={isSuperAdmin || isScopedAdmin}
        canActivateCardRefunds={!isLocalDemoMode && isSuperAdmin}
        globalRefunds={refundManagerSetup.globalRefunds}
        demoManagerAccounts={demoMachineManagerAccounts}
        onDemoMachineManagersSaved={saveDemoMachineManagers}
        onDemoRefundReadinessSaved={saveDemoRefundReadiness}
        onOpenTaxChange={openTaxChangeDialog}
        onShowTaxHistory={setHistoryMachine}
        taxHistoryCount={setup.taxRates.filter((rate) => rate.machine_id === selectedMachineForEditor?.id).length}
        onSaved={refresh}
      />
      <TaxChangeDialog
        open={isTaxChangeDialogOpen}
        onOpenChange={closeTaxChangeDialog}
        form={taxChangeForm}
        setForm={setTaxChangeForm}
        machine={setup.machines.find((machine) => machine.id === taxChangeForm.machineId) ?? null}
        isInitialSetup={!setup.taxRates.some((rate) => rate.machine_id === taxChangeForm.machineId)}
        isSaving={Boolean(taxChangeForm.machineId && savingTaxMachineId === taxChangeForm.machineId)}
        onSave={saveTaxChange}
        treatments={taxTreatments}
      />
      <TaxHistorySheet
        machine={historyMachine}
        rates={taxHistoryRates}
        onOpenChange={(open) => !open && setHistoryMachine(null)}
      />
    </AppLayout>
  );
}

function demoSourceIdentity(machine: PartnershipSetupMachine): MachineSourceInventoryItem {
  return { sourceKey: `demo:${machine.id}`, platform: machine.machine_type === 'snapcase' ? 'Kexiaozhan' : 'Sunze',
    providerAccountId: null, sourceAccountKey: null, sourceId: machine.sunze_machine_id ?? machine.id,
    sourceName: machine.machine_label, sourceStatus: null, discoveryStatus: null, firstSeenAt: null,
    lastSeenAt: null, sourceTimezone: null, lastSourceTransaction: null, reportingMachineId: machine.id,
    mappingConflict: false, archivedMapping: false };
}

function sourceTransactionLabel(source: MachineSourceInventoryItem): string {
  if (!source.lastSourceTransaction) return 'Unknown';
  if (source.platform === 'Sunze') return source.lastSourceTransaction.slice(0, 10);
  try {
    return new Date(source.lastSourceTransaction).toLocaleString(undefined, { timeZone: source.sourceTimezone || 'UTC' });
  } catch { return 'Unknown'; }
}

function compactTransactionDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unavailable';
}

function ImportedSourcePortfolioRow({ source, canSetup, onSetup }: {
  source: MachineSourceInventoryItem; canSetup: boolean; onSetup: () => void;
}) {
  const blocked = source.mappingConflict || source.archivedMapping || Boolean(source.reportingMachineId);
  return <>
  <MachineMobileCard name={source.sourceName || 'Unnamed imported machine'} state={source.catalogueInactiveAt ? 'Inactive' : 'Setup'} company={source.companyName || 'Not assigned'} platform={source.platform} readerStatus={source.nayaxMachineId ? 'Connected' : 'Not matched'} refundStatus="Setup needed" lastTransaction={source.reportingMachineId ? 'Setup details unavailable' : 'None recorded in Hub'} sourceKey={source.sourceKey} canManage={canSetup} onManage={onSetup} attention={blocked ? source.mappingConflict ? 'Exact mapping conflict — review before setup' : 'Hub setup unavailable — retry loading' : undefined}>
    <p>{source.platform} · ID {source.sourceId}{source.sourceAccountKey ? ` · ${source.sourceAccountKey}` : ''}</p>
    <p>Nayax: {source.nayaxMachineId ? `${source.nayaxName || 'Saved Nayax record'} · ID ${source.nayaxMachineId} · ${source.nayaxAccountKey}` : 'Not matched'}</p>
    <p>{source.platform === 'Kexiaozhan' ? 'Last positive source observation' : 'Last source transaction'}: {sourceTransactionLabel(source)}</p>
    <p>Last seen: {source.lastSeenAt ? new Date(source.lastSeenAt).toLocaleDateString() : 'Unknown'}</p>
  </MachineMobileCard>
  <div role="row" data-source-key={source.sourceKey} className="hidden gap-4 px-4 py-5 text-sm sm:grid sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
    <div role="cell" className="min-w-0 break-words"><CellLabel>Source machine</CellLabel><p className="font-semibold">{source.sourceName || 'Unnamed imported machine'}</p><p className="mt-1 text-xs text-muted-foreground">{source.platform} · ID {source.sourceId}{source.sourceAccountKey ? ` · ${source.sourceAccountKey}` : ''}</p><Badge variant="outline" className="mt-2">{source.catalogueInactiveAt ? 'Inactive' : blocked ? 'Setup needs review' : 'Setup needed'}</Badge><p className="mt-1 text-xs text-muted-foreground">State: {source.catalogueInactiveAt ? 'Inactive' : 'Setup — provisional'}</p></div>
    <div role="cell"><CellLabel>Nayax match</CellLabel><p className="break-words">{source.nayaxMachineId ? `${source.nayaxName || 'Saved Nayax record'} · ID ${source.nayaxMachineId} · ${source.nayaxAccountKey}` : 'Not matched'}</p></div>
    <div role="cell"><CellLabel>Company</CellLabel><p>{source.reportingMachineId ? 'Setup details unavailable' : 'Not assigned'}</p></div>
    <div role="cell"><CellLabel>Managers</CellLabel><p>{source.reportingMachineId ? 'Setup details unavailable' : 'Not assigned'}</p></div>
    <div role="cell"><CellLabel>Last recorded transaction</CellLabel><p>{source.reportingMachineId ? 'Setup details unavailable' : 'None recorded in Hub'}</p><p className="mt-1 text-xs text-muted-foreground">{source.platform === 'Kexiaozhan' ? 'Last positive source observation' : 'Last source transaction'}: {source.lastSourceTransaction ? sourceTransactionLabel(source) : 'Unknown'}</p><p className="mt-1 text-xs text-muted-foreground">{source.platform} · Last seen {source.lastSeenAt ? new Date(source.lastSeenAt).toLocaleDateString() : 'Unknown'}</p></div>
    <div role="cell" className="xl:text-right">{canSetup && <Button className="min-h-11 text-base" variant="outline" onClick={onSetup}>Manage</Button>}{blocked && <p className="mt-1 text-xs text-muted-foreground">{source.mappingConflict ? 'Exact mapping conflict — review before setup' : source.archivedMapping ? 'Existing archived setup — restore explicitly' : 'Hub setup unavailable — retry loading'}</p>}</div>
  </div></>;
}

function MachinePortfolioRow({ row, metadata, source, isHighlighted, globalRefunds, refundSetup, onEdit }: {
  row: MachineSetupRowViewModel;
  metadata?: MachineWorkspaceMetadata;
  source?: MachineSourceInventoryItem;
  isHighlighted: boolean;
  globalRefunds: RefundManagerSetup['globalRefunds'];
  refundSetup: RefundManagerSetup['machines'][number] | null;
  onEdit: (machine: PartnershipSetupMachine, tab?: MachineDetailTab) => void;
}) {
  const { machine } = row;
  const identities = source ? [{ platform: source.platform, account: source.sourceAccountKey, id: source.sourceId, name: source.sourceName }] : metadata?.sources;
  const refundAvailability = machineRefundAvailability(refundSetup, globalRefunds);
  const refundStatus = refundAvailability.label;
  const nayaxId = metadata?.nayaxMachineId ?? source?.nayaxMachineId;
  const nayaxName = metadata?.nayaxName ?? source?.nayaxName;
  const nayaxAccount = metadata?.nayaxAccountKey ?? source?.nayaxAccountKey;
  return <>
  <MachineMobileCard name={machine.machine_label} state={source?.catalogueInactiveAt || machine.status !== 'active' ? 'Inactive' : machine.operational_phase === 'setup' ? 'Setup' : 'Live'} company={machine.account_name || 'Company not set'} platform={source?.platform || 'Source unavailable'} readerStatus={nayaxId ? 'Connected' : metadata || source ? 'Not matched' : 'Unavailable'} refundStatus={refundStatus} lastTransaction={metadata ? metadata.lastRecordedTransaction ? compactTransactionDate(metadata.lastRecordedTransaction) : 'None recorded' : 'Unavailable'} managerCount={row.machineManagerEmails.length} sourceKey={source?.sourceKey || machine.id} highlighted={isHighlighted} onManage={() => onEdit(machine, 'overview')} attention={source?.salesActivationPending ? 'Sales activation awaits reconciliation.' : undefined}>
    {metadata?.excludeCashFromFinancialReporting && <Badge variant="outline">Cash excluded</Badge>}
    {identities?.map((identity) => <p key={`${identity.platform}:${identity.account}:${identity.id}`}>{identity.platform}: {identity.name || 'Unnamed source machine'} · ID {identity.id}{identity.account ? ` · ${identity.account}` : ''}</p>)}
    <p>Nayax: {nayaxId ? `${nayaxName || 'Unnamed Nayax record'} · ID ${nayaxId} · Account ${nayaxAccount || 'Unavailable'}` : 'Not matched'}</p>
    <p>Managers: {row.machineManagerEmails.join(', ') || 'Unassigned'}</p>
    <p>Refunds: {refundAvailability.reason}</p>
    {metadata && <p>{transactionAgeLabel(metadata.lastRecordedTransaction)} · {transactionSourceLabel(metadata.transactionSource)} · {importFreshnessLabel(metadata.lastSuccessfulSalesImport)}</p>}
    {metadata?.lastRecordedTransaction && <p>Recorded transaction: {metadata.lastRecordedTransaction}</p>}
    {source && <p>{source.platform === 'Kexiaozhan' ? 'Last positive source observation' : 'Last source transaction'}: {sourceTransactionLabel(source)}</p>}
  </MachineMobileCard>
  <div role="row" data-source-key={source?.sourceKey} className={cn('hidden gap-4 px-4 py-5 text-sm hover:bg-muted/20 sm:grid sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-start', isHighlighted && 'bg-primary/5')}>
    <div role="cell" className="min-w-0 break-words">
      <CellLabel>Source machine</CellLabel>
      <p className="font-semibold">{machine.machine_label}</p>
      {metadata?.excludeCashFromFinancialReporting && <Badge variant="outline" className="mt-2 mr-2">Cash excluded</Badge>}
      {identities?.length ? identities.map((source) => <div key={`${source.platform}:${source.account}:${source.id}`} className="mt-2"><p className="text-xs text-muted-foreground">{source.platform === 'Kexiaozhan' ? 'SnapCase · Kexiaozhan' : source.platform}: {source.name || 'Unnamed source machine'} · ID {source.id}{source.account ? ` · ${source.account}` : ''}</p></div>) : <p className="mt-1 text-xs text-muted-foreground">{metadata ? 'Source not connected' : 'Source data unavailable'}</p>}
      {machine.status !== 'active' && <Badge variant="outline" className="mt-2">Inactive · history retained</Badge>}
      <Badge variant="outline" className="mt-2">{source?.catalogueInactiveAt || machine.status !== 'active' ? 'Inactive' : machine.operational_phase === 'setup' ? 'Setup' : 'Live'}</Badge>
      {source?.salesActivationPending && <p className="mt-2 text-xs text-muted-foreground">Source connected for management. Sales activation awaits reconciliation; existing sales history is unchanged.</p>}
    </div>
    <div role="cell" className="min-w-0 break-words"><CellLabel>Nayax match</CellLabel><p className="font-semibold">{nayaxId ? nayaxName || 'Unnamed Nayax record' : metadata || source ? 'Not matched' : 'Mapping data unavailable'}</p>{nayaxId && <p className="mt-1 text-xs text-muted-foreground">ID {nayaxId}<br/>Account {nayaxAccount || 'TGPACI_USA_DB (legacy)'}</p>}<p className="mt-2 text-xs text-muted-foreground">Refunds: {refundStatus}</p></div>
    <div role="cell" className="min-w-0 break-words"><CellLabel>Company</CellLabel><p className="font-medium">{machine.account_name || 'Company not set'}</p><p className="mt-2 text-xs text-muted-foreground">State: {source?.catalogueInactiveAt ? 'Inactive' : machine.operational_phase === 'setup' ? 'Setup — provisional' : formatLabel(machine.operational_phase || machine.status || 'unknown')}</p></div>
    <div role="cell" className="min-w-0 break-words"><CellLabel>Managers</CellLabel>{row.machineManagerEmails.length ? row.machineManagerEmails.map((email) => <p key={email} className="mb-1 text-xs">{email}</p>) : <p className="text-muted-foreground">Unassigned</p>}</div>
    <div role="cell" className="min-w-0 break-words"><CellLabel>Last recorded transaction</CellLabel><p className="font-medium">{metadata ? metadata.lastRecordedTransaction ? formatDate(metadata.lastRecordedTransaction) : 'No transactions recorded' : 'Transaction data unavailable'}</p>{metadata && <p className="mt-1 text-xs text-muted-foreground">{transactionAgeLabel(metadata.lastRecordedTransaction)} · {transactionSourceLabel(metadata.transactionSource)}<br/>{importFreshnessLabel(metadata.lastSuccessfulSalesImport)}</p>}{source && <p className="mt-1 text-xs text-muted-foreground">{source.platform} · {source.platform === 'Kexiaozhan' ? 'Last positive source observation' : 'Last source transaction'}: {sourceTransactionLabel(source)}</p>}</div>
    <div role="cell" className="flex flex-col items-end sm:col-span-2 xl:col-span-1"><Button variant="outline" className="min-h-11 shrink-0" onClick={() => onEdit(machine, 'overview')}>Manage<ChevronRight className="ml-1.5 h-4 w-4" /></Button></div>
  </div></>;
}

function CellLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:sr-only',
        className
      )}
    >
      {children}
    </div>
  );
}

function RefundNayaxInventoryPanel({
  inventory,
  machines,
  isLoading,
  error,
  canReconcile,
  canBulkActivate,
  isBulkActivating,
  eligibleActivationCount,
  onBulkActivate,
  onSaved,
  focusedInventoryId,
}: {
  inventory: RefundNayaxInventory | null;
  machines: PartnershipSetupMachine[];
  isLoading: boolean;
  error: Error | null;
  canReconcile: boolean;
  canBulkActivate: boolean;
  isBulkActivating: boolean;
  eligibleActivationCount: number;
  onBulkActivate: () => Promise<void>;
  onSaved: () => Promise<void>;
  focusedInventoryId?: string | null;
}) {
  const [inventoryView, setInventoryView] = useState<'attention' | 'published' | 'excluded' | 'all'>(
    focusedInventoryId ? 'all' : 'attention'
  );
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryCategory, setInventoryCategory] = useState<'all' | 'cotton_candy' | 'snapcase' | 'unknown' | 'unclassified'>('all');
  const [inventoryMapping, setInventoryMapping] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [operationNotice, setOperationNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const activeMachines = inventory?.machines.filter((machine) => machine.providerActive) ?? [];
  const normalizedSearch = inventorySearch.trim().toLowerCase();
  const visibleMachines = activeMachines
    .filter((machine) => {
      const isStale = machine.state === 'published' && machine.missingSuccessfulSnapshots > 0;
      const matchesView =
        inventoryView === 'all' ||
        (inventoryView === 'attention' && (machine.state === 'needs_setup' || isStale)) ||
        (inventoryView === 'published' && machine.state === 'published') ||
        (inventoryView === 'excluded' && machine.state === 'excluded');
      const matchesSearch =
        !normalizedSearch ||
        [machine.machineName, machine.machineNumber, machine.nayaxMachineId, machine.accountKey]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      const matchesCategory =
        inventoryCategory === 'all' ||
        (inventoryCategory === 'unclassified' ? !machine.category : machine.category === inventoryCategory);
      const matchesMapping =
        inventoryMapping === 'all' ||
        (inventoryMapping === 'linked' ? Boolean(machine.reportingMachineId) : !machine.reportingMachineId);
      return matchesView && matchesSearch && matchesCategory && matchesMapping;
    })
    .sort((left, right) => {
      const leftFocused = [left.id, left.nayaxMachineId].includes(focusedInventoryId ?? '');
      const rightFocused = [right.id, right.nayaxMachineId].includes(focusedInventoryId ?? '');
      if (leftFocused !== rightFocused) return leftFocused ? -1 : 1;
      return (left.machineName ?? left.nayaxMachineId).localeCompare(right.machineName ?? right.nayaxMachineId);
    });
  const lastRunNeedsAttention = inventory?.lastRun?.status === 'failed' || inventory?.lastRun?.largeDrop === true;

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="refund-nayax-inventory-title">
      <div className="border-b border-border bg-muted/20 p-4 sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="refund-nayax-inventory-title" className="font-semibold text-foreground">
              Inventory review
            </h2>
            {inventory && <Badge variant="outline">{inventory.summary.active} active</Badge>}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Review exceptions first. Published and excluded records stay available when you need
            the full audit trail.
          </p>
        </div>
        <div className="mt-3 flex flex-col items-start gap-2 sm:mt-0 sm:items-end">
          {inventory?.lastRun && (
            <div className="text-left text-xs text-muted-foreground sm:text-right">
              <div className={cn('font-semibold', lastRunNeedsAttention && 'text-destructive')}>
                Last sync: {inventory.lastRun.largeDrop ? 'Large drop — review' : formatLabel(inventory.lastRun.status)}
              </div>
              <div title={new Date(inventory.lastRun.completedAt).toISOString()}>{formatUpdatedAt(inventory.lastRun.completedAt)}</div>
            </div>
          )}
          {canBulkActivate && (
            <Button variant="outline" className="min-h-11" onClick={() => void onBulkActivate()} disabled={isBulkActivating || eligibleActivationCount === 0}>
              {isBulkActivating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Activate {eligibleActivationCount} qualified machine {eligibleActivationCount === 1 ? 'capability' : 'capabilities'}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-destructive">
          <span>Unable to load Nayax setup. No inventory decisions were changed.</span>
          <Button variant="outline" size="sm" onClick={() => void onSaved()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Nayax inventory...
        </div>
      ) : !inventory ? (
        <div className="p-4 text-sm text-muted-foreground">No successful inventory snapshot is available yet.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border px-4 py-3 text-sm text-muted-foreground" aria-label="Nayax inventory summary">
            <span><strong className="font-semibold text-foreground">{inventory.summary.needsSetup + inventory.summary.stalePublished}</strong> need review</span>
            <span><strong className="font-semibold text-foreground">{inventory.summary.published}</strong> published</span>
            <span><strong className="font-semibold text-foreground">{inventory.summary.excluded}</strong> excluded</span>
            {inventory.lastRun && <span title={new Date(inventory.lastRun.completedAt).toISOString()}>{formatUpdatedAt(inventory.lastRun.completedAt)}</span>}
          </div>
          <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <nav className="flex flex-wrap gap-1" aria-label="Nayax inventory views">
              {([
                ['attention', 'Needs review', inventory.summary.needsSetup + inventory.summary.stalePublished],
                ['published', 'Published', inventory.summary.published],
                ['excluded', 'Excluded', inventory.summary.excluded],
                ['all', 'All', inventory.summary.active],
              ] as const).map(([value, label, count]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={inventoryView === value ? 'secondary' : 'ghost'}
                  aria-current={inventoryView === value ? 'page' : undefined}
                  onClick={() => setInventoryView(value)}
                >
                  {label} <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>
                </Button>
              ))}
            </nav>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search inventory" aria-label="Search Nayax inventory" className="h-11 pl-9" />
              </div>
              <select aria-label="Filter Nayax category" value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value as typeof inventoryCategory)} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All categories</option>
                <option value="cotton_candy">Cotton candy</option>
                <option value="snapcase">Snapcase</option>
                <option value="unknown">Product unverified</option>
                <option value="unclassified">Unclassified</option>
              </select>
              <select aria-label="Filter exact mapping" value={inventoryMapping} onChange={(event) => setInventoryMapping(event.target.value as typeof inventoryMapping)} className="h-11 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All mappings</option>
                <option value="linked">Linked</option>
                <option value="unlinked">Not linked</option>
              </select>
            </div>
          </div>
          {inventoryView === 'attention' && lastRunNeedsAttention && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">The latest Nayax sync needs review</div>
                  <div className="mt-0.5 text-xs text-amber-900/80">
                    {inventory.lastRun?.largeDrop ? 'The active inventory dropped sharply.' : 'The latest sync failed.'} Review sync health before treating this inventory as current.
                  </div>
                </div>
              </div>
            </div>
          )}
          {operationNotice && (
            <div role={operationNotice.kind === 'error' ? 'alert' : 'status'} className={cn('border-b px-4 py-3 text-sm', operationNotice.kind === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
              {operationNotice.message}
            </div>
          )}
          {visibleMachines.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" />
              <div className="mt-2 font-medium text-foreground">
                {inventoryView === 'attention' && !lastRunNeedsAttention ? 'No Nayax setup needs attention' : inventoryView === 'attention' ? 'No machine-level exceptions found' : 'No machines match this view'}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {inventoryView === 'attention' && lastRunNeedsAttention
                  ? 'The sync-level exception above still requires review.'
                  : inventoryView === 'attention'
                  ? 'Published and excluded machines remain available in their views.'
                  : 'Try another view or clear the search.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleMachines.map((machine) => (
                <RefundNayaxInventoryRow
                  key={machine.id}
                  inventoryMachine={machine}
                  inventoryMachines={activeMachines}
                  reportingMachines={machines}
                   canReconcile={canReconcile}
                  onSaved={onSaved}
                  onOperationNotice={setOperationNotice}
                   initiallyOpen={[machine.id, machine.nayaxMachineId].includes(focusedInventoryId ?? '')}
                 />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RefundNayaxInventoryRow({
  inventoryMachine,
  reportingMachines,
  canReconcile,
  onSaved,
  onOperationNotice,
  initiallyOpen,
}: {
  inventoryMachine: RefundNayaxInventoryMachine;
  inventoryMachines: RefundNayaxInventoryMachine[];
  reportingMachines: PartnershipSetupMachine[];
  canReconcile: boolean;
  onSaved: () => Promise<void>;
  onOperationNotice: (notice: { kind: 'success' | 'error'; message: string }) => void;
  initiallyOpen: boolean;
}) {
  const [isReviewing, setIsReviewing] = useState(initiallyOpen);
  const [state, setState] = useState<RefundNayaxInventoryState>(inventoryMachine.state);
  const [category, setCategory] = useState<RefundNayaxInventoryCategory>(inventoryMachine.category);
  const [reportingMachineId, setReportingMachineId] = useState(inventoryMachine.reportingMachineId ?? '');
  const [exclusionReason, setExclusionReason] = useState(inventoryMachine.exclusionReason ?? '');
  const [auditReason, setAuditReason] = useState('');
  const [mode, setMode] = useState<'replace' | 'reconcile'>('reconcile');
  const [saveNotice, setSaveNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canReplace = inventoryMachine.state === 'published'
    && Boolean(inventoryMachine.reportingMachineId);

  useEffect(() => {
    setState(inventoryMachine.state);
    setCategory(inventoryMachine.category);
    setReportingMachineId(inventoryMachine.reportingMachineId ?? '');
    setExclusionReason(inventoryMachine.exclusionReason ?? '');
    setSaveNotice(null);
  }, [inventoryMachine]);

  useEffect(() => {
    setMode(canReplace ? 'replace' : 'reconcile');
  }, [canReplace, inventoryMachine.id]);

  const reportError = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    setSaveNotice({ kind: 'error', message });
    toast.error(message);
  };

  const save = async () => {
    if (auditReason.trim().length < 8) {
      reportError(null, 'Add a short audit reason before saving.');
      return;
    }
    if (state === 'excluded' && !exclusionReason.trim()) {
      reportError(null, 'An explicit exclusion reason is required.');
      return;
    }
    setSaveNotice(null);
    setIsSaving(true);
    try {
      await reconcileRefundNayaxMachineAdmin({
        inventoryId: inventoryMachine.id,
        state,
        category,
        reportingMachineId: reportingMachineId || null,
        exclusionReason: state === 'excluded' ? exclusionReason.trim() : null,
        reason: auditReason.trim(),
      });
      const successMessage = `${inventoryMachine.machineName || 'Nayax machine'} was saved and verified.`;
      setSaveNotice({ kind: 'success', message: successMessage });
      onOperationNotice({ kind: 'success', message: successMessage });
      toast.success(successMessage);
      setAuditReason('');
      try {
        await onSaved();
      } catch {
        setSaveNotice({ kind: 'success', message: `${successMessage} Refresh the page to reload the latest inventory.` });
        onOperationNotice({ kind: 'success', message: `${successMessage} Refresh the page to reload the latest inventory.` });
      }
    } catch (saveError) {
      reportError(saveError, 'Unable to save the inventory decision.');
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className={cn('p-4', isReviewing && 'bg-muted/15')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-foreground">{inventoryMachine.machineName || 'Unnamed Nayax machine'}</div>
            <Badge variant={inventoryMachine.state === 'published' ? 'default' : inventoryMachine.state === 'excluded' ? 'secondary' : 'outline'}>
              {formatLabel(inventoryMachine.state)}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Nayax ID {inventoryMachine.nayaxMachineId}
            {(!isReviewing || mode === 'reconcile' || !canReplace) && (
              <> · {inventoryMachine.accountKey}{inventoryMachine.machineNumber ? ` · provider record ${inventoryMachine.machineNumber}` : ''}</>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Current reason: {formatLabel(inventoryMachine.setupReason)}</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setIsReviewing((value) => !value)}>
          {isReviewing ? 'Close' : canReconcile ? 'Review' : 'View'}
          {isReviewing ? <ChevronDown className="ml-1.5 h-4 w-4" /> : <ChevronRight className="ml-1.5 h-4 w-4" />}
        </Button>
      </div>

      {isReviewing && (
      <div className="mt-4 border-t border-border pt-4">
        {canReconcile && canReplace && (
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Nayax reader administration">
            <Button type="button" size="sm" variant={mode === 'replace' ? 'secondary' : 'ghost'} aria-pressed={mode === 'replace'} onClick={() => { setMode('replace'); setSaveNotice(null); }}>
              <ArrowRightLeft className="mr-2 h-4 w-4" /> Replace reader
            </Button>
            <Button type="button" size="sm" variant={mode === 'reconcile' ? 'secondary' : 'ghost'} aria-pressed={mode === 'reconcile'} onClick={() => { setMode('reconcile'); setSaveNotice(null); }}>
              Other setup change
            </Button>
          </div>
        )}

        {mode === 'replace' && canReplace ? (
          <div className="space-y-3 rounded-md border border-border bg-background p-3">
            <p className="text-sm">Change the reader in Manage to review the current and replacement IDs, the actual change date, and preserved history.</p>
            <Button asChild className="min-h-11"><Link to={`/admin/machines/${encodeURIComponent(inventoryMachine.reportingMachineId!)}`}>Open Manage to change reader</Link></Button>
          </div>
        ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] xl:items-end">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`inventory-state-${inventoryMachine.id}`}>Status</Label>
            <select
              id={`inventory-state-${inventoryMachine.id}`}
              value={state}
              onChange={(event) => { setState(event.target.value as RefundNayaxInventoryState); setSaveNotice(null); }}
              disabled={!canReconcile || isSaving}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="needs_setup">Needs setup</option>
              <option value="published">Published</option>
              <option value="excluded">Excluded</option>
            </select>
          </div>
          <div>
            <Label htmlFor={`inventory-category-${inventoryMachine.id}`}>Category</Label>
            <select
              id={`inventory-category-${inventoryMachine.id}`}
              value={category ?? ''}
              onChange={(event) => { setCategory((event.target.value || null) as RefundNayaxInventoryCategory); setSaveNotice(null); }}
              disabled={!canReconcile || isSaving}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Not classified</option>
              <option value="cotton_candy">Cotton candy</option>
              <option value="snapcase">Snapcase</option>
              <option value="unknown">Product unverified</option>
            </select>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor={`inventory-link-${inventoryMachine.id}`}>Exact Bloomjoy machine</Label>
            <select
              id={`inventory-link-${inventoryMachine.id}`}
              value={reportingMachineId}
              onChange={(event) => { setReportingMachineId(event.target.value); setSaveNotice(null); }}
              disabled={!canReconcile || isSaving}
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Not linked</option>
              {reportingMachines.map((machine) => (
                <option key={machine.id} value={machine.id}>{machine.machine_label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`inventory-reason-${inventoryMachine.id}`}>
              {state === 'excluded' ? 'Exclusion reason' : 'Audit reason'}
            </Label>
            <Input
              id={`inventory-reason-${inventoryMachine.id}`}
              value={state === 'excluded' ? exclusionReason : auditReason}
              onChange={(event) => {
                if (state === 'excluded') setExclusionReason(event.target.value);
                else setAuditReason(event.target.value);
                setSaveNotice(null);
              }}
              placeholder={state === 'excluded' ? 'Test or internal machine' : 'Why this decision is safe'}
              disabled={!canReconcile || isSaving}
            />
            {state === 'excluded' && (
              <Input
                className="mt-2"
                value={auditReason}
                onChange={(event) => { setAuditReason(event.target.value); setSaveNotice(null); }}
                placeholder="Audit note"
                aria-label="Exclusion audit note"
                disabled={!canReconcile || isSaving}
              />
            )}
          </div>
        </div>

        {canReconcile ? (
          <Button size="sm" onClick={save} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        ) : (
          <Badge variant="outline">View only</Badge>
        )}
        </div>
        )}
        {saveNotice && (
          <div role={saveNotice.kind === 'error' ? 'alert' : 'status'} className={cn('mt-4 rounded-md border px-3 py-2 text-sm', saveNotice.kind === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
            {saveNotice.message}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function TaxChangeDialog({
  open,
  onOpenChange,
  form,
  setForm,
  machine,
  isInitialSetup,
  isSaving,
  onSave,
  treatments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: typeof emptyTaxChangeForm;
  setForm: (form: typeof emptyTaxChangeForm) => void;
  machine: PartnershipSetupMachine | null;
  isInitialSetup: boolean;
  isSaving: boolean;
  onSave: () => void;
  treatments: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchReportingTaxTreatments>>>>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isInitialSetup ? 'Set reporting tax rate' : 'Change reporting tax rate'}</DialogTitle>
          <DialogDescription>
            {isInitialSetup
              ? 'Add reporting settings for this machine’s history. Confirm the effective date before saving.'
              : 'Choose when these reporting settings take effect. The previous rate ends the day before.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-1">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="text-xs font-medium uppercase text-muted-foreground">Machine</div>
            <div className="mt-1 font-medium text-foreground">{machine?.machine_label ?? 'Select a machine'}</div>
          </div>
          <div>
            <Label htmlFor="tax-change-rate">New reporting tax %</Label>
            <Input
              id="tax-change-rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.taxRatePercent}
              onChange={(event) => setForm({ ...form, taxRatePercent: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="tax-change-start">Applies from</Label>
            <Input
              id="tax-change-start"
              type="date"
              value={form.effectiveStartDate}
              onChange={(event) => setForm({ ...form, effectiveStartDate: event.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {isInitialSetup
                ? 'Initial setup defaults to Jan 1, 2026 so earlier reports remain covered.'
                : 'Choose the first day the new rate should be used.'}
            </p>
          </div>
          <div>
            <Label htmlFor="tax-change-reason">Reason</Label>
            <Input
              id="tax-change-reason"
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              placeholder={isInitialSetup ? 'Initial reporting tax setup' : 'Machine moved to a new jurisdiction'}
            />
          </div>
          <TaxTreatmentFields
            values={{
              card: form.cardTreatment ?? treatmentDraft(getEffectiveReportingTaxTreatment(treatments.data ?? [], form.machineId, 'card', form.effectiveStartDate)),
              cash: form.cashTreatment ?? treatmentDraft(getEffectiveReportingTaxTreatment(treatments.data ?? [], form.machineId, 'cash', form.effectiveStartDate)),
            }}
            rate={form.taxRatePercent}
            loading={treatments.isLoading}
            error={treatments.isError}
            disabled={isSaving}
            onRetry={() => void treatments.refetch()}
            onChange={(tender, value) => setForm({ ...form, [tender === 'card' ? 'cardTreatment' : 'cashTreatment']: value })}
          />
        </div>
        <DialogFooter className="shrink-0 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {isInitialSetup ? 'Set tax rate' : 'Save rate change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActiveFilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-muted/30 pl-3 text-sm font-medium text-foreground">
      {label}
      <button
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-4 w-4" />
      </button>
    </span>
  );
}

function TaxHistorySheet({
  machine,
  rates,
  onOpenChange,
}: {
  machine: PartnershipSetupMachine | null;
  rates: ReportingMachineTaxRate[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(machine)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Reporting tax history</SheetTitle>
        <SheetDescription className="sr-only">
            {machine
              ? `${machine.machine_label} reporting tax rates used for historical partner reports.`
              : 'Machine reporting tax rates used for historical partner reports.'}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 grid gap-3">
          {rates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No reporting tax rates have been saved for this machine.
            </div>
          ) : (
            rates.map((taxRate) => (
              <div key={taxRate.id} className="rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{Number(taxRate.tax_rate_percent).toFixed(2)}%</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Applies {formatDate(taxRate.effective_start_date)}
                      {taxRate.effective_end_date ? ` through ${formatDate(taxRate.effective_end_date)}` : ' onward'}
                    </div>
                  </div>
                  <Badge variant={taxRate.status === 'active' ? 'default' : 'outline'}>{formatLabel(taxRate.status)}</Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MachineDialog({
  open,
  onOpenChange,
  machine,
  importedSource,
  onImportedSourceSaved,
  committedImportedMachineId,
  machines,
  refundManagerSetup,
  refundInventory = null,
  isRefundInventoryLoading = false,
  refundInventoryError = null,
  isRefundManagerSetupLoading,
  isLocalDemoMode,
  canEditMachineIdentity,
  canManageReportingTax = canEditMachineIdentity,
  canActivateCardRefunds,
  globalRefunds,
  demoManagerAccounts,
  onDemoMachineManagersSaved,
  onDemoRefundReadinessSaved,
  onSaved,
  mode = 'sheet',
  activeTab = 'overview',
  onTabChange,
  backHref = '/admin/machines',
  machineRow,
  onOpenTaxChange,
  onShowTaxHistory,
  taxHistoryCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: PartnershipSetupMachine | null;
  importedSource?: MachineSourceInventoryItem | null;
  onImportedSourceSaved?: (machineId: string) => void;
  committedImportedMachineId?: string | null;
  machines: PartnershipSetupMachine[];
  refundManagerSetup: RefundManagerSetup['machines'][number] | null;
  refundInventory?: RefundNayaxInventory | null;
  isRefundInventoryLoading?: boolean;
  refundInventoryError?: unknown;
  isRefundManagerSetupLoading: boolean;
  isLocalDemoMode: boolean;
  canEditMachineIdentity: boolean;
  canManageReportingTax?: boolean;
  canActivateCardRefunds: boolean;
  globalRefunds: RefundManagerSetup['globalRefunds'];
  demoManagerAccounts: AdminAccountSummary[];
  onDemoMachineManagersSaved: (machineId: string, managerEmails: string[]) => Promise<unknown>;
  onDemoRefundReadinessSaved: (machineId: string, readiness: DemoRefundReadiness) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
  mode?: 'sheet' | 'page';
  activeTab?: MachineDetailTab;
  onTabChange?: (tab: MachineDetailTab) => void;
  backHref?: string;
  machineRow?: MachineSetupRowViewModel | null;
  onOpenTaxChange?: (machine: PartnershipSetupMachine, taxRate?: ReportingMachineTaxRate) => void;
  onShowTaxHistory?: (machine: PartnershipSetupMachine) => void;
  taxHistoryCount?: number;
}) {
  const [form, setForm] = useState(emptyMachineForm);
  const [sourceStateDraft, setSourceStateDraft] = useState<'setup' | 'live' | 'inactive'>('setup');
  const stateInventory = useQuery({ queryKey: machineSourceInventoryQueryKey, queryFn: fetchMachineSourceInventorySnapshot, enabled: open && !isLocalDemoMode, retry: false });
  const stateSourceMatches = stateInventory.data?.sources.filter((source) => importedSource ? source.sourceKey === importedSource.sourceKey : source.reportingMachineId === machine?.id) ?? [];
  const stateSource = stateSourceMatches.length === 1 ? stateSourceMatches[0] : null;
  const savedSourceState = stateSource?.catalogueInactiveAt ? 'inactive' : machine?.operational_phase ?? 'setup';
  const sourceStateNotice = stateInventory.isError ? 'State could not be loaded. Retry before saving.' : stateInventory.isFetching ? 'Loading State…' : !stateSource ? stateSourceMatches.length > 1 ? 'Choose the exact imported source to change State.' : 'State is unavailable until the imported source is verified.' : !machine && stateSource.catalogueInactiveAt ? 'Restore Setup first, then complete setup to go Live.' : null;
  const stateReadHelp = sourceStateNotice ? <div className="mt-2 text-sm" role="status">{sourceStateNotice}{stateInventory.isError && <Button type="button" variant="outline" className="ml-2 min-h-11 text-base" onClick={() => void stateInventory.refetch()}>Retry State</Button>}</div> : null;
  const stateOnlySave = !!stateSource && sourceStateDraft !== savedSourceState && (!!machine || sourceStateDraft !== 'live');
  useEffect(() => { if (open) setSourceStateDraft(savedSourceState); }, [open, stateSource?.sourceKey, savedSourceState]);

  const [mappingHasChanges, setMappingHasChanges] = useState(false);
  const [sourceInventoryId, setSourceInventoryId] = useState('');
  const sourceNayaxInventory = useQuery({ queryKey: ['admin-refund-nayax-inventory'], queryFn: fetchRefundNayaxInventory, enabled: open && !!importedSource && !machine, staleTime: 30000 });
  const sourceReuseOptions = useQuery({ queryKey: ['imported-source-reuse', importedSource?.sourceKey], queryFn: () => fetchImportedSourceReuseOptions(importedSource!), enabled: open && !!importedSource && !machine, staleTime: 0, retry: false });
  const sourceReuseOption = sourceReuseOptions.data?.find((option) => option.inventoryId === sourceInventoryId);
  const sourceReuseVerified = !sourceReuseOptions.isError && !sourceReuseOptions.isFetching && !!sourceReuseOption;
  const [reviewSourceReaderMove, setReviewSourceReaderMove] = useState(false);
  const [sourceReaderChangedOn, setSourceReaderChangedOn] = useState('');
  const [sourceReaderChangedLocal, setSourceReaderChangedLocal] = useState('');
  const [sourceReaderChangedAt, setSourceReaderChangedAt] = useState('');
  const [sourceReaderMoveConfirmed, setSourceReaderMoveConfirmed] = useState(false);
  useEffect(() => {
    setReviewSourceReaderMove(false); setSourceReaderChangedOn(''); setSourceReaderChangedLocal('');
    setSourceReaderChangedAt(''); setSourceReaderMoveConfirmed(false);
  }, [importedSource?.sourceKey, sourceInventoryId, open]);
  const sourceReaderPreview = useQuery({
    queryKey: ['imported-reader-change-preview', sourceInventoryId, form.locationTimezone, sourceReaderChangedLocal],
    queryFn: () => previewImportedReaderChange(sourceInventoryId, form.locationTimezone, sourceReaderChangedLocal || null),
    enabled: open && !!importedSource && !machine && !!sourceInventoryId && !!form.locationTimezone,
    retry: false,
  });
  const sourceMove = sourceReaderPreview.data;
  const sourceMoveVerified = !!sourceMove && !sourceReaderPreview.isError && !sourceReaderPreview.isFetching;
  const sourceReaderOccupied = !!importedSource && !machine && !committedImportedMachineId && Boolean(
    sourceNayaxInventory.data?.machines.find(reader => reader.id === sourceInventoryId)?.reportingMachineId
      || sourceReuseOption?.machineId || sourceMove?.ownerMachineId || sourceMove?.historicalOwnerConflict);
  useEffect(() => {
    setSourceReaderMoveConfirmed(false); setSourceReaderChangedAt('');
  }, [sourceInventoryId, form.accountId, form.machineLabel, form.locationTimezone, sourceMove?.expectedOwnerUpdatedAt, sourceReaderChangedOn, sourceReaderChangedLocal]);
  const [reuseConfirmed, setReuseConfirmed] = useState(false);
  useEffect(() => { setReuseConfirmed(false); }, [importedSource?.sourceKey, sourceInventoryId, sourceReuseOption?.machineId, sourceReuseOption?.expectedMachineUpdatedAt, sourceReuseOption?.timezone]);
  const reuseExistingMachine = async () => {
    if (!importedSource || !sourceReuseVerified || !sourceReuseOption?.eligible || !reuseConfirmed || isSaving) return;
    setIsSaving(true);
    try {
      const id = await reuseImportedSourceMachine(importedSource, sourceReuseOption);
      onImportedSourceSaved?.(id);
      toast.success('Source and reader saved to the existing machine.');
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to use the existing machine.');
      setReuseConfirmed(false);
      await sourceReuseOptions.refetch();
    }
    finally { setIsSaving(false); }
  };
  const { user: assignmentUser } = useAuth();
  const taxSource = useQuery({
    queryKey: ['admin-machine-tax-source', assignmentUser?.id, machine?.id, refundManagerSetup?.nayaxAccountKey, refundManagerSetup?.nayaxMachineId],
    enabled: open && !!machine?.id && !isLocalDemoMode,
    queryFn: async () => {
      const { supabaseClient } = await import('@/lib/supabaseClient');
      const { data, error } = await supabaseClient.rpc('admin_reporting_machine_source_tax', { p_machine_id: machine!.id });
      if (error) throw error;
      return data as { coverageStatus: string; source: string | null; observedAt: string | null; ratePercent: number | null; saleDate: string; latestProbeStatus?: string; latestProbeAt?: string };
    },
    staleTime: 30000,
  });
  const importedTaxSource = useQuery({
    queryKey: ['admin-imported-machine-tax-source', assignmentUser?.id, sourceInventoryId],
    enabled: open && !!importedSource && !machine && !!sourceInventoryId,
    queryFn: async () => {
      const { supabaseClient } = await import('@/lib/supabaseClient');
      const { data, error } = await supabaseClient.rpc('admin_get_imported_machine_tax', { p_inventory_id: sourceInventoryId });
      if (error) throw error;
      return data as { coverageStatus: string; source: string | null; ratePercent: number | null; saleDate: string };
    },
    staleTime: 30000,
  });
  const companyChoices = useQuery({ queryKey: [...companyChoicesQueryKey, assignmentUser?.id], queryFn: fetchCompanyChoices, enabled: open && canEditMachineIdentity, staleTime: 30000 });
  const loadedIdentityKeyRef = useRef('');
  const newAssociationKeyRef = useRef(crypto.randomUUID());
  const currentAssignment: SavedCompanyAssignment | null = machine ? {
    accountId: machine.account_id ?? '', accountName: machine.account_name,
    locationId: machine.location_id ?? '', locationName: machine.location_name,
    locationTimezone: machine.location_timezone ?? '',
  } : null;
  const [savedAssignment, setSavedAssignment] = useState<SavedCompanyAssignment | null>(currentAssignment);
  const assignmentFields = (id: string) => <CompanyAssignmentFields id={id} authoritativeTimezone={importedSource?.sourceTimezone} internalLocationName={`Unmapped Hub ${machine?.id || newAssociationKeyRef.current}`} value={form} saved={savedAssignment} autoSelectSingleCompany={!machine && !importedSource} enabled={open && canEditMachineIdentity} disabled={!canEditMachineIdentity || isSaving} onChange={(assignment) => setForm((current) => ({ ...current, ...assignment }))} />;
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishingCustomerRefunds, setIsPublishingCustomerRefunds] = useState(false);
  const [selectedMachineManagerEmails, setSelectedMachineManagerEmails] = useState<string[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [managerFlow, setManagerFlow] = useState<'closed' | 'assign' | 'invite'>('closed');
  const [inviteEmail, setInviteEmail] = useState('');
  const [isAddingMachineManager, setIsAddingMachineManager] = useState(false);
  const [isSendingMachineManagerInvite, setIsSendingMachineManagerInvite] = useState(false);
  const [isSavingMachineManagers, setIsSavingMachineManagers] = useState(false);
  const [machineManagerSaveState, setMachineManagerSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [refundIntakeEnabled, setRefundIntakeEnabled] = useState(false);
  const [isSavingRefundReadiness, setIsSavingRefundReadiness] = useState(false);
  const [refundReadinessSaveState, setRefundReadinessSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [isActivatingCardRefunds, setIsActivatingCardRefunds] = useState(false);
  const loadedMachineManagerKeyRef = useRef('');
  const queryClient = useQueryClient();
  const savedMachineManagerEmails = useMemo(
    () => uniqueEmails(refundManagerSetup?.managerEmails ?? []),
    [refundManagerSetup]
  );
  const normalizedManagerSearch = normalizeEmail(managerSearch);
  const selectedMachineManagerSet = useMemo(
    () => new Set(selectedMachineManagerEmails),
    [selectedMachineManagerEmails]
  );
  const {
    data: remoteManagerSuggestions = emptyAccountSummaries,
    isFetching: isSearchingRemoteMachineManagers,
    error: remoteManagerSearchError,
  } = useQuery({
    queryKey: ['admin-machine-manager-search', normalizedManagerSearch],
    queryFn: () => fetchAdminAccountSummaries(normalizedManagerSearch),
    enabled:
      !isLocalDemoMode &&
      open &&
      Boolean(form.machineId) &&
      managerFlow === 'assign' &&
      normalizedManagerSearch.length >= 3,
    staleTime: 1000 * 30,
  });
  const managerSuggestions = useMemo(
    () =>
      isLocalDemoMode
        ? demoManagerAccounts.filter((account) =>
            normalizeEmail(account.customer_email ?? '').includes(normalizedManagerSearch)
          )
        : remoteManagerSuggestions,
    [demoManagerAccounts, isLocalDemoMode, normalizedManagerSearch, remoteManagerSuggestions]
  );
  const isSearchingMachineManagers = !isLocalDemoMode && isSearchingRemoteMachineManagers;
  const managerSearchError = isLocalDemoMode ? null : remoteManagerSearchError;
  const {
    data: machineManagerInviteDeliveries = [],
    isFetching: isFetchingMachineManagerInviteDeliveries,
  } = useQuery({
    queryKey: ['access-invite-deliveries', 'machine_manager', form.machineId],
    queryFn: () =>
      fetchAccessInviteDeliveries({
        inviteType: 'machine_manager',
        sourceType: 'reporting_machine',
        sourceIds: form.machineId ? [form.machineId] : [],
      }),
    enabled: open && Boolean(form.machineId) && !isLocalDemoMode,
    staleTime: 1000 * 20,
  });
  const visibleManagerSuggestions = useMemo(
    () =>
      managerSuggestions
        .filter((account) => account.customer_email)
        .filter((account) => !selectedMachineManagerSet.has(normalizeEmail(account.customer_email ?? '')))
        .slice(0, 5),
    [managerSuggestions, selectedMachineManagerSet]
  );
  const latestMachineManagerInvite = machineManagerInviteDeliveries[0] ?? null;

  const buildRefundReadinessDraft = (includeManagers = false): RefundReadinessDraft | null => {
    if (!includeManagers && !emailListsEqual(selectedMachineManagerEmails, savedMachineManagerEmails)) {
      toast.error('Save or cancel the pending Machine Manager changes before saving refund setup.');
      return null;
    }

    if (refundIntakeEnabled && (includeManagers ? selectedMachineManagerEmails : savedMachineManagerEmails).length < 1) {
      toast.error('Save at least one Machine Manager before enabling transaction matching.');
      return null;
    }

    return {
      displayLabel: refundManagerSetup?.refundPublicDisplayLabel || machine?.machine_label || form.machineLabel,
      normalizedNayaxMachineId: refundManagerSetup?.nayaxMachineId || '',
      normalizedNayaxAccountKey: refundManagerSetup?.nayaxAccountKey || '',
    };
  };

  const refundReadinessHasChanges = Boolean(form.machineId) &&
    refundIntakeEnabled !== (refundManagerSetup?.refundIntakeEnabled ?? false);

  const persistRefundReadinessDraft = async (draft: RefundReadinessDraft) => {
    if (!form.machineId) return;

    setIsSavingRefundReadiness(true);
    setRefundReadinessSaveState('idle');

    try {
      if (isLocalDemoMode) {
        await onDemoRefundReadinessSaved(form.machineId, {
          refundIntakeEnabled,
          refundPublicDisplayLabel: draft.displayLabel || null,
          nayaxMachineId: draft.normalizedNayaxMachineId || null,
          nayaxAccountKey: draft.normalizedNayaxMachineId ? draft.normalizedNayaxAccountKey : null,
        });
        setRefundReadinessSaveState('saved');
        return;
      }

      await saveMachineRefundSettings(form.machineId, refundIntakeEnabled);
      setRefundReadinessSaveState('saved');
    } catch (error) {
      setRefundReadinessSaveState('error');
      throw error;
    } finally {
      setIsSavingRefundReadiness(false);
    }
  };

  useEffect(() => {
    if (!open) { loadedIdentityKeyRef.current = ''; return; }
    const identityKey = machine?.id ?? importedSource?.sourceKey ?? 'new';
    if (loadedIdentityKeyRef.current === identityKey) return;
    loadedIdentityKeyRef.current = identityKey;
    setSavedAssignment(machine ? {
      accountId: machine.account_id ?? '', accountName: machine.account_name,
      locationId: machine.location_id ?? '', locationName: machine.location_name,
      locationTimezone: machine.location_timezone ?? '',
    } : null);
    if (!machine) {
      setSourceInventoryId('');
      setSelectedMachineManagerEmails([]);
      setForm({
        ...emptyMachineForm,
        machineLabel: importedSource?.sourceName ?? '',
        machineType: importedSource?.platform === 'Kexiaozhan' ? 'snapcase' : 'commercial',
        sunzeMachineId: importedSource?.platform === 'Sunze' ? importedSource.sourceId : '',
        operationalPhase: 'setup',
        locationTimezone: importedSource?.sourceTimezone ?? '',
        accountId: '',
        locationId: '',
        addLocation: false,
        locationName: '',
      });
      return;
    }

    setForm({
      machineId: machine.id,
      accountId: machine.account_id ?? '',
      locationId: machine.location_id ?? '',
      addLocation: false,
      locationName: machine.location_name,
      locationTimezone: machine.location_timezone ?? '',
      machineLabel: machine.machine_label,
      machineType: normalizeMachineType(machine.machine_type) ?? '',
      sunzeMachineId: machine.sunze_machine_id ?? '',
      operationalPhase: machine.operational_phase ?? 'live',
    });
  }, [machine, importedSource, open]);

  useEffect(() => {
    if (!open) return;
    const nextLoadedKey = `${form.machineId ?? 'new'}:${savedMachineManagerEmails.join('\n')}`;
    if (loadedMachineManagerKeyRef.current === nextLoadedKey) return;
    loadedMachineManagerKeyRef.current = nextLoadedKey;
    if (!emailListsEqual(selectedMachineManagerEmails, savedMachineManagerEmails)) {
      setSelectedMachineManagerEmails(savedMachineManagerEmails);
      setMachineManagerSaveState('idle');
    }
    setManagerSearch('');
    setInviteEmail('');
    setManagerFlow('closed');
  }, [form.machineId, open, savedMachineManagerEmails, selectedMachineManagerEmails]);

  useEffect(() => {
    if (!open || !form.machineId) return;

    setRefundIntakeEnabled(refundManagerSetup?.refundIntakeEnabled ?? false);
    setRefundReadinessSaveState('idle');
  }, [
    form.machineId,
    open,
    refundManagerSetup?.refundIntakeEnabled,
    refundManagerSetup?.refundPublicDisplayLabel,
    refundManagerSetup?.nayaxMachineId,
    refundManagerSetup?.nayaxAccountKey,
  ]);

  const saveMachine = async (scope: 'all' | 'identity' | 'refund' = 'all') => {
    if (committedImportedMachineId) {
      setIsSaving(true);
      try { await onSaved(); } catch { toast.error('Machine setup is saved. Retry loading its details.'); }
      finally { setIsSaving(false); }
      return;
    }
    if (scope !== 'refund' && stateOnlySave) {
      if (!stateSource || stateInventory.isError || stateInventory.isFetching) { toast.error('Reload the source before saving its state.'); return; }
      setIsSaving(true);
      try {
        await setMachineSourceState(stateSource, sourceStateDraft, stateSource.machineUpdatedAt ?? null);
        await onSaved();
        toast.success('State saved.');
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save state.'); }
      finally { setIsSaving(false); }
      return;
    }
    const shouldSaveIdentity = scope !== 'refund' && canEditMachineIdentity && (mode !== 'page' || !machine || machineIdentityHasChanges);
    const shouldSaveRefunds = scope !== 'identity' && Boolean(form.machineId) && refundReadinessHasChanges;
    const shouldSaveManagers = scope === 'all' && Boolean(form.machineId) && machineManagerHasChanges;

    if (shouldSaveIdentity && !form.machineLabel.trim()) {
      toast.error('Machine name is required.');
      return;
    }

    if (shouldSaveIdentity && !form.machineType) {
      toast.error('Choose a machine type before saving.');
      return;
    }

    if (shouldSaveIdentity) {
      const assignmentError = validateCompanyAssignment(form, companyChoices.data?.companies ?? [], savedAssignment);
      if (assignmentError) { toast.error(assignmentError); return; }
    }

    const machineLabel = form.machineLabel.trim();
    const sunzeMachineId = form.sunzeMachineId.trim();
    const duplicateSunze = sunzeMachineId
      ? machines.find(
          (candidate) =>
            candidate.id !== form.machineId &&
            normalizeComparableText(candidate.sunze_machine_id ?? '') === normalizeComparableText(sunzeMachineId)
        )
      : null;
    if (shouldSaveIdentity && duplicateSunze) {
      toast.error('This external machine ID is already assigned to another machine.');
      return;
    }

    const refundReadinessDraft = shouldSaveRefunds ? buildRefundReadinessDraft(scope === 'all') : null;
    if (shouldSaveRefunds && !refundReadinessDraft) {
      return;
    }

    setIsSaving(true);
    try {
      if (isLocalDemoMode) {
        if (shouldSaveManagers && !await persistMachineManagerEmails(selectedMachineManagerEmails, 'Machine Managers saved.')) return;
        if (shouldSaveRefunds && refundReadinessDraft && refundReadinessHasChanges) {
          await persistRefundReadinessDraft(refundReadinessDraft);
        }
        toast.success(
          shouldSaveRefunds && refundReadinessHasChanges
            ? 'Demo mode saved this refund setup in the browser only.'
            : 'Demo mode is visual only for machine identity changes.'
        );
        if (mode === 'sheet') onOpenChange(false);
        return;
      }

      if (!shouldSaveIdentity) {
        if (shouldSaveManagers && !await persistMachineManagerEmails(selectedMachineManagerEmails, 'Machine Managers saved.')) return;
        if (shouldSaveRefunds && refundReadinessDraft && refundReadinessHasChanges) {
          await persistRefundReadinessDraft(refundReadinessDraft);
          toast.success('Refund setup saved.');
          await onSaved();
        } else if (!shouldSaveManagers) {
          toast.info('No refund setup changes to save.');
        }
        if (mode === 'sheet') onOpenChange(false);
        return;
      }

      if (importedSource && !form.machineId) {
        if (sourceInventoryId && (!sourceMoveVerified || sourceMove?.historicalOwnerConflict || sourceMove?.ownerArchived)) throw new Error('Reload and review the reader connection before saving.');
        if (sourceReaderOccupied && (!reviewSourceReaderMove || !sourceReaderMoveConfirmed || !sourceReaderChangedOn || !sourceReaderChangedAt || !sourceMove?.expectedOwnerUpdatedAt)) throw new Error('Review the current owner and actual reader change time.');
        const id = await setupImportedMachine(importedSource, { accountId: form.accountId, machineName: machineLabel, machineType: form.machineType, operationalPhase: form.operationalPhase, timezone: form.locationTimezone, inventoryId: sourceInventoryId, managerEmails: selectedMachineManagerEmails, ...(sourceReaderOccupied ? { readerChange: { expectedOwnerUpdatedAt: sourceMove!.expectedOwnerUpdatedAt!, changedOn: sourceReaderChangedOn, changedAt: sourceReaderChangedAt } } : {}) });
        onImportedSourceSaved?.(id);
        toast.success('Machine setup saved.');
        await onSaved();
        return;
      }

      if (shouldSaveIdentity) {
        await upsertReportingMachineAdmin({
          ...form,
          accountId: form.accountId,
          locationId: form.addLocation ? null : form.locationId,
          newLocationName: form.addLocation ? form.locationName.trim() : null,
          newLocationTimezone: form.addLocation ? form.locationTimezone : null,
          expectedAccountId: savedAssignment?.accountId || null,
          expectedLocationId: savedAssignment?.locationId || null,
          machineLabel,
          expectedDisplayName: machine?.machine_label ?? null,
          sunzeMachineId: machine ? machine.sunze_machine_id : sunzeMachineId || null,
          reason: form.machineId ? 'Reporting machine identity updated' : 'Reporting machine created',
        });
        loadedIdentityKeyRef.current = '';
        // Company changes affect derived access across reporting and refund views.
        // Recheck active views and discard inactive cached scopes before revisiting them.
        if (savedAssignment && savedAssignment.accountId !== form.accountId) {
          queryClient.removeQueries({ type: 'inactive', predicate: (query) => !String(query.queryKey[0] ?? '').startsWith('admin-') });
          await queryClient.invalidateQueries();
        }
      }
      if (shouldSaveManagers && !await persistMachineManagerEmails(selectedMachineManagerEmails, 'Machine Managers saved.')) return;
      if (shouldSaveRefunds && refundReadinessDraft && refundReadinessHasChanges) {
        await persistRefundReadinessDraft(refundReadinessDraft);
      }
      toast.success(
        scope === 'refund'
          ? 'Refund setup saved.'
          : form.machineId
            ? scope === 'all' && refundReadinessHasChanges
              ? 'Machine and refund setup saved.'
              : 'Machine updated.'
            : 'Machine created.'
      );
      if (mode === 'sheet') onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine.');
    } finally {
      setIsSaving(false);
    }
  };

  const persistMachineManagerEmails = async (
    nextEmails: string[],
    successMessage: string
  ) => {
    if (!form.machineId) return false;

    if (nextEmails.length > 4) {
      toast.error('Each machine can have up to 4 Machine Managers.');
      return false;
    }

    const previousEmails = savedMachineManagerEmails;
    setIsSavingMachineManagers(true);
    setMachineManagerSaveState('idle');

    try {
      if (isLocalDemoMode) {
        await onDemoMachineManagersSaved(form.machineId, nextEmails);
        setMachineManagerSaveState('saved');
        toast.success(`${successMessage} Demo mode saved this assignment in the browser only.`);
        return true;
      }

      await setMachineRefundManagersAdmin({
        machineId: form.machineId,
        managerEmails: nextEmails,
        reason: 'Machine manager assignment updated from Admin Machines',
      });
      setMachineManagerSaveState('saved');
      toast.success(successMessage);
      await onSaved();
      return true;
    } catch (error) {
      setSelectedMachineManagerEmails(previousEmails);
      setMachineManagerSaveState('error');
      const message = error instanceof Error ? error.message : 'Unable to save Machine Managers.';
      toast.error(
        message.includes('must be an authenticated user')
          ? 'That person needs to sign in to Bloomjoy once before they can be assigned as a Machine Manager.'
          : message
      );
      return false;
    } finally {
      setIsSavingMachineManagers(false);
    }
  };

  const addMachineManagerEmail = async (email: string, options: { verifyAuthUser?: boolean } = {}) => {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) return;

    if (!emailPattern.test(normalizedEmail)) {
      toast.error('Enter a valid manager email address.');
      return;
    }

    if (selectedMachineManagerSet.has(normalizedEmail)) {
      setManagerSearch('');
      return;
    }

    if (selectedMachineManagerEmails.length >= 4) {
      toast.error('Each machine can have up to 4 Machine Managers.');
      return;
    }

    setIsAddingMachineManager(true);
    try {
      if (options.verifyAuthUser ?? true) {
        if (isLocalDemoMode) {
          const demoAccount = demoManagerAccounts.find(
            (account) => normalizeEmail(account.customer_email ?? '') === normalizedEmail
          );
          if (!demoAccount) {
            throw new Error('Use one of the demo users shown in Matching users for local UAT.');
          }
        } else {
          const person = await lookupReportingUserByEmailAdmin(normalizedEmail);
          if (!person.userEmail) {
            throw new Error('This authenticated user does not have an email on file.');
          }
        }
      }
      const nextEmails = uniqueEmails([...selectedMachineManagerEmails, normalizedEmail]);
      setSelectedMachineManagerEmails(nextEmails);
      setMachineManagerSaveState('idle');
      setManagerSearch('');
      toast.success('Manager added to pending changes.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to find an authenticated user for that email.';
      toast.error(
        message.startsWith('No user found')
          ? 'That person needs to sign in to Bloomjoy once before they can be assigned as a Machine Manager.'
          : message
      );
    } finally {
      setIsAddingMachineManager(false);
    }
  };

  const sendMachineManagerSignupInvite = async (email: string) => {
    const normalizedEmail = normalizeEmail(email);

    if (!form.machineId) {
      toast.error('Save or select a machine before sending a Machine Manager invite.');
      return;
    }

    if (!normalizedEmail) return;

    if (!emailPattern.test(normalizedEmail)) {
      toast.error('Enter a valid manager email address.');
      return;
    }

    if (selectedMachineManagerSet.has(normalizedEmail)) {
      toast.info('This email is already assigned as a Machine Manager for this machine.');
      return;
    }

    if (isLocalDemoMode) {
      toast.info('Demo mode does not send invite emails. Use a PR branch with Supabase configured for functional invite QA.');
      return;
    }

    const invitePreflight = validateAccessInvitePreflight('machine_manager', normalizedEmail);
    if (!invitePreflight.ok) {
      toast.error(invitePreflight.message);
      return;
    }

    setIsSendingMachineManagerInvite(true);
    try {
      await sendAccessInvite({
        inviteType: 'machine_manager',
        sourceId: form.machineId,
        targetEmail: invitePreflight.targetEmail,
        loginUrl: invitePreflight.loginUrl,
      });
      queryClient.setQueryData<AccessInviteDelivery[]>(
        ['access-invite-deliveries', 'machine_manager', form.machineId],
        (current = []) => [
          {
            id: `local-machine-manager-invite-${Date.now()}`,
            inviteType: 'machine_manager',
            sourceType: 'reporting_machine',
            sourceId: form.machineId,
            targetEmail: invitePreflight.targetEmail,
            sentBy: null,
            sentAt: new Date().toISOString(),
            deliveryStatus: 'sent',
            errorMessage: null,
          },
          ...current.filter(
            (delivery) =>
              delivery.targetEmail !== invitePreflight.targetEmail ||
              delivery.sourceId !== form.machineId ||
              delivery.inviteType !== 'machine_manager'
          ),
        ]
      );
      toast.success('Machine Manager invite sent. Assign this person after they sign in.');
      setManagerSearch('');
      setInviteEmail('');
      setManagerFlow('closed');
      await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to send Machine Manager invite.');
      await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
    } finally {
      setIsSendingMachineManagerInvite(false);
    }
  };

  const removeMachineManagerEmail = (email: string) => {
    setSelectedMachineManagerEmails((emails) => emails.filter((entry) => entry !== email));
    setMachineManagerSaveState('idle');
  };

  const machineManagerHasChanges =
    selectedMachineManagerEmails.join('|') !== savedMachineManagerEmails.join('|');

  const machineIdentityHasChanges = Boolean(machine) && (
    sourceStateDraft !== savedSourceState ||
    form.machineLabel.trim() !== machine.machine_label ||
    form.accountId !== (machine.account_id ?? '') ||
    form.locationId !== (machine.location_id ?? '') ||
    form.addLocation ||
    form.machineType !== (normalizeMachineType(machine.machine_type) ?? '') ||
    form.sunzeMachineId.trim() !== (machine.sunze_machine_id ?? '') ||
    form.operationalPhase !== (machine.operational_phase ?? 'live')
  );

  const importedIdentityHasChanges = Boolean(importedSource) && (
    sourceStateDraft !== savedSourceState ||
    form.machineLabel !== (importedSource?.sourceName ?? '') || Boolean(form.accountId) || Boolean(sourceInventoryId) ||
    form.locationTimezone !== (importedSource?.sourceTimezone ?? '') ||
    form.machineType !== (importedSource?.platform === 'Kexiaozhan' ? 'snapcase' : 'commercial') ||
    form.operationalPhase !== 'setup'
  );
  const hasUnsavedChanges = !committedImportedMachineId && (importedIdentityHasChanges || mappingHasChanges || machineManagerHasChanges || refundReadinessHasChanges || machineIdentityHasChanges);

  const cancelMachineIdentityChanges = useCallback(() => {
    setSourceStateDraft(savedSourceState);
    if (!machine) return;
    setSavedAssignment({
      accountId: machine.account_id ?? '', accountName: machine.account_name,
      locationId: machine.location_id ?? '', locationName: machine.location_name,
      locationTimezone: machine.location_timezone ?? '',
    });
    setForm({
      machineId: machine.id,
      accountId: machine.account_id ?? '',
      locationId: machine.location_id ?? '',
      addLocation: false,
      locationName: machine.location_name,
      locationTimezone: machine.location_timezone ?? '',
      machineLabel: machine.machine_label,
      machineType: normalizeMachineType(machine.machine_type) ?? '',
      sunzeMachineId: machine.sunze_machine_id ?? '',
      operationalPhase: machine.operational_phase ?? 'live',
    });
  }, [machine, savedSourceState]);

  const cancelMachineManagerChanges = useCallback(() => {
    setSelectedMachineManagerEmails(savedMachineManagerEmails);
    setManagerSearch('');
    setInviteEmail('');
    setManagerFlow('closed');
    setMachineManagerSaveState('idle');
  }, [savedMachineManagerEmails]);

  const cancelRefundReadinessChanges = useCallback(() => {
    setRefundIntakeEnabled(refundManagerSetup?.refundIntakeEnabled ?? false);
    setRefundReadinessSaveState('idle');
  }, [refundManagerSetup]);

  const discardAllPendingChanges = useCallback(() => {
    setMappingHasChanges(false);
    cancelMachineIdentityChanges();
    cancelMachineManagerChanges();
    cancelRefundReadinessChanges();
  }, [cancelMachineIdentityChanges, cancelMachineManagerChanges, cancelRefundReadinessChanges]);

  const confirmDiscardPendingChanges = () =>
    !(hasUnsavedChanges || sourceStateDraft !== savedSourceState) || window.confirm('Discard the unsaved changes on this machine?');

  const requestTabChange = (nextTab: MachineDetailTab) => {
    if (nextTab === activeTab) return;
    // Settings tabs are one editor: preserve drafts while moving between sections.
    onTabChange?.(nextTab);
  };

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (mode !== 'page' || !hasUnsavedChanges) return;
    return registerMachineNavigationGuard(() => window.confirm('Discard the unsaved changes on this machine?'));
  }, [hasUnsavedChanges, mode]);

  const machineManagerCount = selectedMachineManagerEmails.length;
  const isSavingMachineChanges = isSaving || isSavingMachineManagers || isSavingRefundReadiness || isActivatingCardRefunds || isPublishingCustomerRefunds;
  const refundReadinessBlocks = [
    savedMachineManagerEmails.length > 0 ? null : 'Assign and save at least one Machine Manager.',
    refundManagerSetup?.nayaxMachineId ? null : 'An imported Nayax match is needed for card lookup.',
  ].filter(Boolean) as string[];
  const activateCardRefunds = async () => {
    if (!form.machineId) return;
    if (!window.confirm(`Activate the card-refund capability for ${form.machineLabel}? Direct API availability is controlled separately.`)) return;
    setIsActivatingCardRefunds(true);
    try {
      await setRefundMachineCardActivationAdmin({
        machineId: form.machineId,
        enabled: true,
        reason: 'Reviewed machine activation from Admin Machines',
      });
      toast.success('Card-refund capability activated.');
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to activate card refunds.');
    } finally {
      setIsActivatingCardRefunds(false);
    }
  };
  const machineReadinessState = refundManagerSetup?.readinessState ?? 'setup_needed';
  const overallReadinessLabel = globalRefunds.paused
    ? 'Paused'
    : !globalRefunds.available && machineReadinessState === 'ready_to_refund'
        ? 'Direct API blocked'
      : refundReadinessLabel(machineReadinessState);
  const directApiStatus = globalRefunds.available
    ? 'Available'
    : globalRefunds.paused
      ? 'Paused'
      : 'Unavailable';
  const cardRefundStatus = refundManagerSetup?.nayaxRefundsEnabled
    ? 'Enabled'
    : `Off — ${refundReasonLabel(
        refundManagerSetup?.readinessBlockReason ?? refundManagerSetup?.paymentDisabledReason ?? null
      )}`;
  const exactRefundReaders = refundInventory?.machines.filter(reader => isExactMachineRefundReader(refundManagerSetup, reader)) ?? [];
  const refundReader = exactRefundReaders.length === 1 ? exactRefundReaders[0] : null;
  const refundAvailability = machineRefundAvailability(refundManagerSetup, globalRefunds, refundReader);
  const publication = customerRefundPublication({ setup: refundManagerSetup, reader: refundReader, machineType: machine?.machine_type, machineStatus: machine?.status ?? '', catalogueInactive: savedSourceState === 'inactive' });
  const publishCustomerRefunds = async () => {
    if (!publication || isPublishingCustomerRefunds || hasUnsavedChanges || isRefundInventoryLoading || refundInventoryError) return;
    setIsPublishingCustomerRefunds(true);
    try {
      await reconcileRefundNayaxMachineAdmin(publication);
      toast.success('Customer refund requests enabled.');
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to enable customer refund requests.');
    } finally { setIsPublishingCustomerRefunds(false); }
  };

  const effectiveTaxSource = importedSource && !machine ? importedTaxSource : taxSource;
  const taxRateSetup = <div className="rounded-md border border-border p-3 text-sm" aria-label="Source tax rate">
    <p className="font-medium">Tax rate</p>
    <p className="mt-1">{(effectiveTaxSource.isPending || effectiveTaxSource.isFetching) && (machine?.id || sourceInventoryId) ? 'Checking source tax…' : !effectiveTaxSource.isError && effectiveTaxSource.data?.coverageStatus === 'verified_tax' && effectiveTaxSource.data.ratePercent != null ? `${Number(effectiveTaxSource.data.ratePercent)}% · ${effectiveTaxSource.data.source === 'finance_verified' ? 'Finance confirmation' : 'Nayax source'} · ${effectiveTaxSource.data.saleDate}` : 'Unavailable — no verified source tax rate'}</p>
    <p className="mt-1 text-xs text-muted-foreground">Read-only source setting. Cash has no tax deduction.</p>
  </div>;

  if (mode === 'page' && machine) {
    const detailTabs: Array<{ value: MachineDetailTab; label: string }> = [
      { value: 'overview', label: 'Overview' },
      { value: 'refunds', label: 'Refunds' },
      { value: 'managers', label: 'Managers' },
      { value: 'reporting', label: 'Reporting' },
      { value: 'activity', label: 'Activity' },
    ];
    const primaryAttention = machineRow?.attentionReasons[0];

    return (
      <div className="mx-auto max-w-6xl pb-12" data-machine-editor="page">
        <Link
          to={backHref}
          onClick={(event) => {
            if (!confirmDiscardPendingChanges()) event.preventDefault();
          }}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to machines
        </Link>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {machine.machine_label}
              </h1>
              <Badge variant="outline">{formatMachineType(machine.machine_type)}</Badge>
              {machine.operational_phase === 'setup' && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Provisional</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {machine.account_name || 'Company not set'}
            </p>
          </div>
          {machine.operational_phase === 'setup' ? (
            <div className="max-w-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <div className="font-medium">Setup phase</div>
              <div className="mt-0.5 text-xs text-amber-900/80">Available for assignments and Timekeeping while provider setup is incomplete.</div>
            </div>
          ) : primaryAttention ? (
            <div className="max-w-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <div className="flex gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">{primaryAttention.label}</div>
                  <div className="mt-0.5 text-xs text-amber-900/80">{primaryAttention.nextStep}</div>
                  {(machineRow?.attentionReasons.length ?? 0) > 1 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900/80">
                      {machineRow?.attentionReasons.slice(1).map((reason) => (
                        <li key={reason.code}>{reason.label} — {reason.nextStep}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Badge className="gap-1.5 self-start">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ready
            </Badge>
          )}
        </div>

        <div className="mt-2 flex justify-end sm:mt-4"><MachineEmailAlerts machineId={machine.id}/></div>
        <nav className="mt-3 overflow-x-auto border-b border-border sm:mt-6" aria-label="Machine setup sections">
          <div className="flex min-w-max gap-5">
            {detailTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-current={activeTab === tab.value ? 'page' : undefined}
                onClick={() => requestTabChange(tab.value)}
                className={cn(
                  'min-h-11 border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                  activeTab === tab.value
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
                {tab.value === 'managers' && <span className="ml-1.5 text-muted-foreground">{machineManagerCount}</span>}
              </button>
            ))}
          </div>
        </nav>

        {activeTab === 'overview' && (
          <section className="mt-6" aria-labelledby="machine-overview-title">
            <div className="mb-5">
              <h2 id="machine-overview-title" className="text-lg font-semibold text-foreground">Machine details</h2>
            </div>
            <MachineIdentityMapping machineId={machine.id} canEdit={canEditMachineIdentity} demo={isLocalDemoMode} onSaved={onSaved} onDirtyChange={setMappingHasChanges} />
            {canEditMachineIdentity ? (
              <>
                <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="page-machine-label">Machine name</Label>
                    <Input id="page-machine-label" className="h-11 min-h-11 text-base md:text-base" maxLength={120} value={form.machineLabel} onChange={(event) => setForm({ ...form, machineLabel: event.target.value })} />
                  </div>
                  {assignmentFields('page-machine')}
                  <div>
                    <Label htmlFor="page-machine-type">Machine type</Label>
                    <select id="page-machine-type" value={form.machineType} onChange={(event) => setForm({ ...form, machineType: event.target.value as CanonicalMachineType })} className="h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base">
                      {machineTypes.map((machineType) => <option key={machineType} value={machineType}>{formatMachineType(machineType)}</option>)}
                    </select>
                    {!form.machineType && <p className="mt-1 text-xs text-amber-700">This legacy record is unverified. Choose its correct type before saving.</p>}
                  </div>
                  <div>
                    <div className="flex items-center justify-between"><Label htmlFor="page-machine-phase">State</Label><MachineHelp label="About operating state">Setup permits timekeeping before setup is finished. Inactive removes the machine from ordinary lists and retains its history; it does not change refund settings.</MachineHelp></div>
                    <select id="page-machine-phase" disabled={isSavingMachineChanges} value={stateSource ? sourceStateDraft : form.operationalPhase} onChange={(event) => { const state = event.target.value as 'setup' | 'live' | 'inactive'; setSourceStateDraft(state); if (state !== 'inactive') setForm({ ...form, operationalPhase: state }); }} className="h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base">
                      <option value="setup" disabled={Boolean(machine && stateSource && !canEditMachineIdentity && machine.operational_phase !== 'setup')}>Setup — provisional</option>
                      <option value="live" disabled={Boolean((!machine && stateSource?.catalogueInactiveAt) || (machine && stateSource && !canEditMachineIdentity && machine.operational_phase !== 'live'))}>Live</option>
                      <option value="inactive" disabled={!stateSource || stateInventory.isError || stateInventory.isFetching}>Inactive</option>
                    </select>
                    {stateReadHelp}
                  </div>
                </div>
              </>
            ) : (
              <dl className="max-w-3xl divide-y divide-border rounded-md border border-border text-sm">
                <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Machine name</dt><dd className="text-right font-medium">{machine.machine_label}</dd></div>
                <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Company</dt><dd className="text-right font-medium">{machine.account_name || 'Not set'}</dd></div>
                <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Machine type</dt><dd className="font-medium">{formatMachineType(machine.machine_type)}</dd></div>
                <div className="px-4 py-3"><Label htmlFor="page-machine-phase">State</Label><select id="page-machine-phase" value={sourceStateDraft} onChange={(event) => setSourceStateDraft(event.target.value as 'setup' | 'live' | 'inactive')} disabled={!stateSource || isSavingMachineChanges} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base"><option value="setup" disabled={machine.operational_phase !== 'setup'}>Setup — provisional</option><option value="live" disabled={machine.operational_phase !== 'live'}>Live</option><option value="inactive" disabled={!stateSource || stateInventory.isError || stateInventory.isFetching}>Inactive</option></select>{stateReadHelp}</div>
              </dl>
            )}
            {taxRateSetup}
          </section>
        )}

        {(activeTab === 'managers' || activeTab === 'overview') && (
          <section className="mt-6 max-w-3xl" aria-labelledby="machine-managers-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="machine-managers-title" className="text-lg font-semibold text-foreground">Machine Managers</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Assign the people who review refund requests and follow up on this machine.
                </p>
              </div>
              <Badge variant="outline">{machineManagerCount} of 4 assigned</Badge>
            </div>

            <div className="mt-5 rounded-md border border-border p-4">
              {selectedMachineManagerEmails.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedMachineManagerEmails.map((email) => (
                    <span key={email} className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-primary/10 pl-3 text-sm font-medium text-primary">
                      <span className="truncate">{email}</span>
                      <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => removeMachineManagerEmail(email)} aria-label={`Remove ${email}`}>
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No Machine Managers assigned.</p>
              )}
              {managerFlow === 'closed' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setManagerFlow('assign')} disabled={machineManagerCount >= 4}>
                    <Plus className="mr-2 h-4 w-4" /> Add manager
                  </Button>
                  <Button variant="ghost" onClick={() => setManagerFlow('invite')}>
                    <Send className="mr-2 h-4 w-4" /> Invite person
                  </Button>
                </div>
              )}
              {managerFlow === 'assign' && (
                <div className="mt-4 rounded-md bg-muted/20 p-3">
                  <Label htmlFor="manager-account-search">Find an existing Bloomjoy account</Label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                      <Input id="manager-account-search" value={managerSearch} onChange={(event) => setManagerSearch(event.target.value)} placeholder="Search by email" className="h-11 pl-9" disabled={machineManagerCount >= 4 || isAddingMachineManager || isSavingMachineManagers} />
                    </div>
                    <Button type="button" variant="outline" onClick={() => void addMachineManagerEmail(managerSearch)} disabled={!managerSearch.trim() || machineManagerCount >= 4 || isAddingMachineManager}>
                      {isAddingMachineManager ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Add
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setManagerSearch(''); setManagerFlow('closed'); }}>Close</Button>
                  </div>
                  <div className="sr-only" aria-live="polite">{isSearchingMachineManagers ? 'Searching accounts' : managerSearch.trim().length >= 3 ? `${visibleManagerSuggestions.length} matching accounts` : ''}</div>
                  {managerSearch.trim().length >= 3 && visibleManagerSuggestions.length > 0 && (
                    <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-background" aria-label="Matching Bloomjoy accounts">
                      {visibleManagerSuggestions.map((account) => {
                        const email = normalizeEmail(account.customer_email ?? '');
                        return <li key={account.user_id}><button type="button" className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm hover:bg-muted/30" onClick={() => void addMachineManagerEmail(email, { verifyAuthUser: false })}>{email}<Plus className="h-4 w-4 text-muted-foreground" /></button></li>;
                      })}
                    </ul>
                  )}
                </div>
              )}
              {managerFlow === 'invite' && (
                <div className="mt-4 rounded-md bg-muted/20 p-3">
                  <Label htmlFor="manager-invite-email">Invite a new person</Label>
                  <p className="mt-1 text-xs text-muted-foreground">An invitation does not grant machine access. Assign the person after they sign in.</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Input id="manager-invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@example.com" className="h-11 flex-1" />
                    <Button type="button" variant="outline" onClick={() => void sendMachineManagerSignupInvite(inviteEmail)} disabled={!emailPattern.test(normalizeEmail(inviteEmail)) || isSendingMachineManagerInvite}>
                      {isSendingMachineManagerInvite ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send invite
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setInviteEmail(''); setManagerFlow('closed'); }}>Close</Button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Changes take effect only after you save.</p>
            </div>
          </section>
        )}

        {activeTab === 'refunds' && (
          <section className="mt-6 max-w-3xl" aria-labelledby="machine-refunds-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="machine-refunds-title" className="text-lg font-semibold text-foreground">Customer refunds</h2>
                <p className="mt-1 text-sm text-muted-foreground">See readiness and fix only what blocks this machine.</p>
              </div>
              <Badge variant={refundAvailability.label === 'Ready to refund' ? 'default' : 'outline'}>{refundAvailability.label}</Badge>
            </div>
            <div className="mt-4 rounded-md border border-border p-4 text-sm">
              <p>{refundAvailability.reason}</p>
              {refundReader?.state === 'excluded' && refundReader.exclusionReason && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 font-medium">Saved exclusion reason</summary><p className="break-words text-muted-foreground">{refundReader.exclusionReason}</p></details>}
              {canActivateCardRefunds && isRefundInventoryLoading && <p role="status" className="mt-2 text-muted-foreground">Checking the saved reader…</p>}
              {canActivateCardRefunds && Boolean(refundInventoryError) && <p role="alert" className="mt-2 text-destructive">Reader details could not load. Retry before enabling customer requests.</p>}
              {canActivateCardRefunds && publication && <Button variant="outline" className="mt-3 min-h-11 h-auto whitespace-normal text-base" onClick={() => void publishCustomerRefunds()} disabled={isSavingMachineChanges || hasUnsavedChanges || isRefundInventoryLoading || Boolean(refundInventoryError)}>Enable customer refund requests</Button>}
              <MachineHelp label="About customer requests and card refunds">Customer requests make this machine available in the refund form. Card-refund processing also requires transaction matching, assigned managers and the existing card-refund capability.</MachineHelp>
              {publication && hasUnsavedChanges && <p className="mt-2 text-muted-foreground">Save or cancel your machine changes before enabling customer requests.</p>}
            </div>
            {globalRefunds.paused && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
                Paused for all machines
              </div>
            )}
            {!globalRefunds.available && !globalRefunds.paused && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Direct card refunds are unavailable. This machine's customer-intake, lookup, and capability settings are shown separately below.
              </div>
            )}
            <dl className="mt-5 divide-y divide-border rounded-md border border-border text-sm">
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Customer requests</dt><dd className="font-medium">{refundManagerSetup?.customerIntakeAccepting ? 'Accepting' : 'Unavailable'}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Transaction lookup</dt><dd className="font-medium">{refundManagerSetup?.transactionLookupReady ? 'Ready' : 'Setup needed'}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Machine Managers</dt><dd className="font-medium">{savedMachineManagerEmails.length} saved</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Card-refund capability</dt><dd className="font-medium">{cardRefundStatus}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Direct API</dt><dd className="font-medium">{directApiStatus}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Refund amount</dt><dd className="font-medium">Exact Nayax sale</dd></div>
            </dl>
            {refundReadinessBlocks.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <div className="font-medium">Setup needed</div>
                <ul className="mt-1 list-disc pl-5">{refundReadinessBlocks.map((block) => <li key={block}>{block}</li>)}</ul>
              </div>
            )}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3 sm:col-span-2">
                <div><Label htmlFor="page-refund-intake">Transaction matching</Label><p className="mt-1 text-xs text-muted-foreground">Allow managers to match requests to Nayax transactions.</p></div>
                <Switch id="page-refund-intake" checked={refundIntakeEnabled} onCheckedChange={setRefundIntakeEnabled} />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              {canActivateCardRefunds && refundManagerSetup?.activationEligible && !refundManagerSetup.nayaxRefundsEnabled && (
                <Button variant="outline" onClick={() => void activateCardRefunds()} disabled={isSavingMachineChanges}>Activate card-refund capability</Button>
              )}
            </div>
          </section>
        )}

        {activeTab === 'reporting' && (
          <section className="mt-6 max-w-3xl" aria-labelledby="machine-reporting-title">
            <h2 id="machine-reporting-title" className="text-lg font-semibold text-foreground">Reporting</h2>
            <p className="mt-1 text-sm text-muted-foreground">Partnership assignment and sales reporting coverage.</p>
            <p className="mt-3 text-sm text-muted-foreground">Card tax comes from verified source information. Cash has no tax deduction. Missing source information remains unresolved in reports.</p>
            <div className="mt-5"><MachineCashReporting key={machine.id} machineId={machine.id} canEdit={canManageReportingTax} demo={isLocalDemoMode} /></div>
            <dl className="mt-5 divide-y divide-border rounded-md border border-border text-sm">
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted-foreground">Partner reports</dt><dd className="text-right font-medium">{machineRow?.activeAssignments.map((assignment) => assignment.partnership_name).join(', ') || 'Not assigned'}</dd></div>
            </dl>
            <details className="mt-4 border-t border-border pt-3">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Tax source diagnostics</summary>
              <p className="mt-2 text-sm text-muted-foreground">{taxSource.isPending ? 'Checking source coverage…' : taxSource.isError || !taxSource.data ? 'Source coverage is unavailable. Finance preserves unresolved amounts.' : taxSource.data.coverageStatus === 'verified_tax' ? `Verified source: ${taxSource.data.source === 'finance_verified' ? 'Finance confirmation' : taxSource.data.source === 'nayax_portal' ? 'Nayax portal export' : taxSource.data.source === 'nayax_portal_history' ? 'Nayax portal history' : 'Nayax API'}. Applies to ${taxSource.data.saleDate}.` : taxSource.data.coverageStatus === 'unclassified_extra_charge' ? 'Nayax extra charge observed. Its tax classification has not been verified.' : 'No verified source tax information for this date.'}</p>
              {taxSource.data?.observedAt && <p className="mt-1 text-xs text-muted-foreground">Observed {new Date(taxSource.data.observedAt).toLocaleString()}.</p>}
              {taxSource.data?.latestProbeStatus === 'unavailable' && <p className="mt-2 text-sm text-muted-foreground">The latest Nayax refresh was unavailable. Any previously verified setting remains in use.</p>}
            </details>
            {machineRow?.attentionReasons.some((reason) => reason.tab === 'reporting') && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <div className="font-medium">Reporting needs attention</div>
                <ul className="mt-1 list-disc pl-5">
                  {machineRow.attentionReasons.filter((reason) => reason.tab === 'reporting').map((reason) => <li key={reason.code}>{reason.label} — {reason.nextStep}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              {canEditMachineIdentity ? (
                <Button variant="ghost" asChild><Link to="/admin/partnerships">Manage partnerships <ChevronRight className="ml-1.5 h-4 w-4" /></Link></Button>
              ) : (
                <p className="self-center text-xs text-muted-foreground">Partnership changes are managed by a Super Admin.</p>
              )}
            </div>
          </section>
        )}

        {activeTab === 'activity' && (
          <section className="mt-6 max-w-3xl" aria-labelledby="machine-activity-title">
            <h2 id="machine-activity-title" className="text-lg font-semibold text-foreground">Activity and audit</h2>
            <p className="mt-1 text-sm text-muted-foreground">Recent operating context and the machine’s broader configuration history.</p>
            <div className="mt-5 divide-y divide-border rounded-md border border-border">
              <div className="flex gap-3 px-4 py-4"><Activity className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><div className="text-sm font-medium">Latest sale</div><div className="mt-0.5 text-sm text-muted-foreground">{machine.latest_sale_date ? formatDate(machine.latest_sale_date) : 'No sales recorded yet'}</div></div></div>
              <div className="flex gap-3 px-4 py-4"><ServerCog className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><div className="text-sm font-medium">Machine status</div><div className="mt-0.5 text-sm text-muted-foreground">{formatLabel(machine.status || 'unknown')}</div></div></div>
              <div className="flex gap-3 px-4 py-4"><Users className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><div className="text-sm font-medium">Manager coverage</div><div className="mt-0.5 text-sm text-muted-foreground">{machineManagerCount} assigned</div></div></div>
            </div>
            <Button variant="outline" asChild className="mt-4"><Link to={`/admin/audit?search=${encodeURIComponent(machine.id)}`}><History className="mr-2 h-4 w-4" /> View full audit history</Link></Button>
          </section>
        )}
        <div className="sticky bottom-0 mt-6 flex flex-wrap justify-end gap-2 border-t bg-background py-4" aria-label="Machine changes">
          <Button variant="outline" className="min-h-11 text-base" onClick={() => { if (confirmDiscardPendingChanges()) { discardAllPendingChanges(); onOpenChange(false); } }} disabled={isSavingMachineChanges}>Cancel</Button>
          <Button className="min-h-11 text-base" onClick={() => void saveMachine('all')} disabled={isSavingMachineChanges || !hasUnsavedChanges || mappingHasChanges || (stateOnlySave && (stateInventory.isError || stateInventory.isFetching)) || (isLocalDemoMode && machineIdentityHasChanges)}>{isSavingMachineChanges && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
        </div>
        {mappingHasChanges && <p className="text-sm text-muted-foreground">Save the reviewed reader connection before saving other machine changes.</p>}
      </div>
    );
  }

  const editorContents = (
    <>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {form.machineId
              ? canEditMachineIdentity
                ? 'Edit Machine'
                : 'Machine Setup'
              : importedSource ? 'Manage Machine' : 'New Manual Machine'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {canEditMachineIdentity
              ? 'Name, company, source identity and managers for this machine.'
              : 'Review machine identity and manage the setup controls available inside your scoped machine grant.'}
          </p>
        </div>
        {committedImportedMachineId ? (
          <div role="status" className="mt-6 rounded-md border border-border bg-muted/30 p-4">
            <p className="font-medium">Machine setup saved</p>
            <p className="mt-2 text-sm text-muted-foreground">Its details have not loaded yet. Retry loading to continue managing this machine.</p>
            <p className="mt-2 text-xs text-muted-foreground">{importedSource?.platform} · ID {importedSource?.sourceId}</p>
          </div>
        ) : <>
        {machine && <MachineIdentityMapping machineId={machine.id} canEdit={canEditMachineIdentity} demo={isLocalDemoMode} onSaved={onSaved} onDirtyChange={setMappingHasChanges} />}
        {machine && <MachineCashReporting key={machine.id} machineId={machine.id} canEdit={canManageReportingTax} demo={isLocalDemoMode} />}
        {importedSource && !machine && <div className="mt-4 space-y-3">
          <div className="text-sm"><p className="font-medium">{importedSource.platform} · {importedSource.sourceName || 'Unnamed imported machine'}</p><p className="break-all text-muted-foreground">ID {importedSource.sourceId}{importedSource.sourceAccountKey ? ` · ${importedSource.sourceAccountKey}` : ''}</p></div>
          <div><Label>Nayax machine</Label><NayaxMachinePicker records={sourceNayaxInventory.data?.machines ?? []} selectedId={sourceInventoryId} currentName="Select a Nayax machine" machineId="" disabled={isSaving || sourceNayaxInventory.isPending || sourceNayaxInventory.isError} allowOccupied onSelect={(id) => { setSourceInventoryId(id); setReuseConfirmed(false); setReviewSourceReaderMove(false); }}/>{sourceNayaxInventory.isError && <p role="alert" className="text-sm text-destructive">Nayax records unavailable. Retry opening this machine.</p>}</div>
          {sourceReaderOccupied && <div className="rounded-md border p-4 space-y-3" role="region" aria-label="Review existing machine connection">
            <p className="font-medium">{sourceReuseVerified && sourceReuseOption?.eligible ? `Connect to ${sourceReuseOption.machineName || 'the existing machine'}` : `Reader currently connected to ${sourceReuseOption?.machineName || 'another machine'}`}</p>
            {sourceReuseVerified && sourceReuseOption?.eligible ? <>
              <p className="break-words text-sm">{importedSource.sourceName || importedSource.platform} · {importedSource.sourceId}<br/>→ {sourceNayaxInventory.data?.machines.find(record => record.id === sourceInventoryId)?.machineName || sourceReuseOption.machineName} · {sourceNayaxInventory.data?.machines.find(record => record.id === sourceInventoryId)?.nayaxMachineId}</p>
              <label className="flex min-h-11 items-center gap-3 text-base"><input type="checkbox" checked={reuseConfirmed} onChange={(event) => setReuseConfirmed(event.target.checked)} disabled={isSaving}/>These are the same machine</label>
              <details className="text-sm text-muted-foreground"><summary className="flex min-h-11 cursor-pointer items-center">Connection details</summary><div className="space-y-2 pt-2"><p>Keep the existing name, company ({sourceReuseOption.companyName}), managers, time zone ({sourceReuseOption.timezone}) and sales history.</p><p>Nayax supplies card revenue; source cash remains included. Source card records do not add another sale. Refund settings stay unchanged.</p></div></details>
            </> : <>
              <p role="alert" className="text-sm">{sourceReuseOptions.isError ? 'Connection details unavailable. Reload before reviewing this reader.' : sourceReuseOptions.isFetching ? 'Loading connection details…' : sourceReuseOption?.reason || 'The current connection could not be verified. Reload and review it.'}</p>
              {sourceReuseOption && <a className="inline-flex min-h-11 items-center underline" href={`/admin/machines/${sourceReuseOption.machineId}`}>Open current machine to review its source connection</a>}
              <Button variant="outline" className="min-h-11" onClick={() => void sourceReuseOptions.refetch()}>Reload connection details</Button>
              <Button variant="outline" className="min-h-11 h-auto w-full min-w-0 whitespace-normal px-3 py-2 text-center" disabled={sourceReuseOptions.isError || sourceReuseOptions.isFetching} onClick={() => setReviewSourceReaderMove(true)}>Review moving this reader to the selected source</Button>

            </>}
          </div>}
        </div>}
        {(!sourceReaderOccupied || reviewSourceReaderMove) && <>
        {reviewSourceReaderMove && <div className="mt-4 rounded-md border p-3 space-y-3 text-sm" role="region" aria-label="Review reader reassignment">
          <p>New source: {importedSource?.platform} · ID {importedSource?.sourceId}. Choose its actual company and saved time zone below. Original transactions stay with their original machine.</p>
          {sourceReaderPreview.isFetching ? <p role="status">Checking reader ownership…</p> : sourceReaderPreview.isError ? <div role="alert">Reader ownership unavailable. <Button variant="link" onClick={() => void sourceReaderPreview.refetch()}>Retry</Button></div> : sourceMove && <>
            <p className="break-words">Reader {sourceMove.newReaderId} · {sourceMove.newAccountKey} · Current machine: {sourceMove.ownerMachineName || sourceMove.ownerMachineId || 'No current owner'}</p>
            {sourceMove.historicalOwnerConflict || sourceMove.ownerArchived ? <p role="alert">Historical or archived ownership requires reconciliation before moving this reader.</p> : <>
              <Label htmlFor="source-reader-change-day">Actual change date</Label><Input id="source-reader-change-day" type="date" className="min-h-11 min-w-0 text-base md:text-base" value={sourceReaderChangedOn} onChange={event => setSourceReaderChangedOn(event.target.value)} disabled={isSaving}/>
              <Label htmlFor="source-reader-change-time">Actual local change time ({sourceMove.timezone})</Label><Input id="source-reader-change-time" type="datetime-local" className="min-h-11 min-w-0 text-base md:text-base" value={sourceReaderChangedLocal} onChange={event => setSourceReaderChangedLocal(event.target.value)} disabled={isSaving}/>
              {sourceReaderChangedLocal && sourceMove.effectiveInstants.length === 0 && <p role="alert">This local time does not exist. Review the actual change time.</p>}
              {sourceMove.effectiveInstants.map(instant => <label key={instant} className="flex min-h-11 items-center gap-2"><input type="radio" name="source-reader-change-instant" checked={sourceReaderChangedAt === instant} onChange={() => { setSourceReaderChangedAt(instant); setSourceReaderMoveConfirmed(false); }}/>{instant} UTC</label>)}
              <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={sourceReaderMoveConfirmed} onChange={event => setSourceReaderMoveConfirmed(event.target.checked)} disabled={!sourceMoveVerified || !sourceReaderChangedOn || !sourceReaderChangedAt || isSaving}/>I reviewed the source, company, current reader owner and actual change time. Ambiguous imported purchases remain pending.</label>
            </>}
          </>}
        </div>}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="machine-label">Machine name</Label>
            <Input
              id="machine-label"
              className="h-11 min-h-11 text-base md:text-base" maxLength={120}
              value={form.machineLabel}
              onChange={(event) => setForm({ ...form, machineLabel: event.target.value })}
              disabled={!canEditMachineIdentity}
            />
          </div>
          {assignmentFields('machine')}
          <div>
            <Label htmlFor="machine-type">Machine type</Label>
            <select
              id="machine-type"
              value={form.machineType}
              onChange={(event) => setForm({ ...form, machineType: event.target.value as CanonicalMachineType })}
              disabled={!canEditMachineIdentity}
              className="h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
            >
              {machineTypes.map((machineType) => (
                <option key={machineType} value={machineType}>
                  {formatMachineType(machineType)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="machine-phase">State</Label><MachineHelp label="About operating state">Setup permits timekeeping before setup is finished. Inactive removes the machine from ordinary lists and retains its history; it does not change refund settings.</MachineHelp></div>
            <select
              id="machine-phase"
              value={stateSource ? sourceStateDraft : form.operationalPhase}
              onChange={(event) => { const state = event.target.value as 'setup' | 'live' | 'inactive'; setSourceStateDraft(state); if (state !== 'inactive') setForm({ ...form, operationalPhase: state }); }}
              disabled={isSavingMachineChanges || (!canEditMachineIdentity && !stateSource)}
              className="h-11 min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-base"
            >
              <option value="setup" disabled={Boolean(machine && stateSource && !canEditMachineIdentity && machine.operational_phase !== 'setup')}>Setup — provisional</option>
              <option value="live" disabled={Boolean((!machine && stateSource?.catalogueInactiveAt) || (machine && stateSource && !canEditMachineIdentity && machine.operational_phase !== 'live'))}>Live</option>
              <option value="inactive" disabled={!stateSource || stateInventory.isError || stateInventory.isFetching}>Inactive</option>
            </select>
            {stateReadHelp}
          </div>
        </div>
        {taxRateSetup}
        {(form.machineId || importedSource) && (
          <>
          <div className="mt-6 rounded-lg border border-border bg-muted/15 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center justify-between"><h3 className="font-semibold text-foreground">Machine Managers</h3><MachineHelp label="About Machine Managers">Select people responsible for customer inquiries, refund review and machine follow-up. Invitations provide a login link; access is assigned only when manager assignments are saved.</MachineHelp></div>
              </div>
              <Badge variant="outline">
                {machineManagerCount === 0
                  ? 'No managers assigned'
                  : machineManagerCount === 1
                    ? '1 manager assigned'
                    : `${machineManagerCount} managers assigned`}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {isSavingMachineManagers ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving changes...
                </span>
              ) : machineManagerSaveState === 'saved' ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved
                </span>
              ) : machineManagerSaveState === 'error' ? (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Last change was not saved
                </span>
              ) : latestMachineManagerInvite ? (
                <span>{formatMachineManagerInviteSummary(latestMachineManagerInvite)}</span>
              ) : isFetchingMachineManagerInviteDeliveries ? (
                <span>Checking Machine Manager invite history...</span>
              ) : (
null
              )}
            </div>

            <div className="mt-4 grid gap-4">
              {isRefundManagerSetupLoading && (
                <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                  Loading current machine manager assignments...
                </div>
              )}
              <div>
                <Label htmlFor="machine-manager-search">People</Label>
                <div className="mt-2 rounded-md border border-input bg-background p-2">
                  {selectedMachineManagerEmails.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {selectedMachineManagerEmails.map((email) => (
                        <span
                          key={email}
                          className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                        >
                          <span className="truncate">{email}</span>
                          <button
                            type="button"
                            onClick={() => removeMachineManagerEmail(email)}
                            disabled={isSavingMachineManagers || isAddingMachineManager}
                            className="rounded-full p-0.5 text-primary/70 hover:bg-primary/15 hover:text-primary"
                            aria-label={`Remove ${email}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      No Machine Managers assigned yet.
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="machine-manager-search"
                        value={managerSearch}
                        onChange={(event) => setManagerSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (isAddingMachineManager || isSavingMachineManagers || machineManagerCount >= 4) {
                              return;
                            }
                            void addMachineManagerEmail(managerSearch);
                          }
                        }}
                        className="h-11 min-h-11 pl-9 text-base md:text-base"
                        placeholder="Search or enter an email"
                        disabled={
                          isAddingMachineManager ||
                          isSendingMachineManagerInvite ||
                          isSavingMachineManagers ||
                          machineManagerCount >= 4
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void addMachineManagerEmail(managerSearch)}
                      disabled={
                        isAddingMachineManager ||
                        isSendingMachineManagerInvite ||
                        isSavingMachineManagers ||
                        machineManagerCount >= 4 ||
                        !managerSearch.trim()
                      }
                    >
                      {isAddingMachineManager ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void sendMachineManagerSignupInvite(managerSearch)}
                      disabled={
                        isAddingMachineManager ||
                        isSendingMachineManagerInvite ||
                        isSavingMachineManagers ||
                        !emailPattern.test(normalizedManagerSearch) ||
                        selectedMachineManagerSet.has(normalizedManagerSearch)
                      }
                    >
                      {isSendingMachineManagerInvite ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Send invite
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  One Machine Manager is enough. Add up to 4 authenticated Machine Managers per
                  machine. Invite new Machine Managers first, then add them after they sign in.
                </p>
                {managerSearchError && (
                  <p className="mt-2 text-sm text-destructive">Unable to search matching users.</p>
                )}
                {managerSearch.trim().length >= 3 && (
                  <div className="mt-2 rounded-md border border-border bg-background">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Matching users
                      </span>
                      {isSearchingMachineManagers && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {visibleManagerSuggestions.length === 0 && !isSearchingMachineManagers ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        No matching account user found. Send an invite for a new login; after the
                        person signs in, search again and choose Add to assign this machine.
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {visibleManagerSuggestions.map((account) => {
                          const email = normalizeEmail(account.customer_email ?? '');

                          return (
                            <button
                              key={account.user_id}
                              type="button"
                              onClick={() => void addMachineManagerEmail(email, { verifyAuthUser: false })}
                              disabled={isSavingMachineManagers || isAddingMachineManager}
                              className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-muted/30"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {email}
                                </span>
                                <span className="block text-xs text-muted-foreground">Bloomjoy user</span>
                              </span>
                              <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {!form.machineId && <p className="mt-2 text-xs text-muted-foreground">Managers are included when you save machine setup.</p>}
                <div className={form.machineId ? "mt-4 flex justify-end" : "hidden"}>
                  <Button
                    type="button"
                    onClick={() => void saveMachineManagers()}
                    disabled={!machineManagerHasChanges || isSavingMachineManagers}
                  >
                    {isSavingMachineManagers && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Machine Managers
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div hidden={!form.machineId} className="mt-6 rounded-lg border border-border bg-muted/15 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Customer refunds</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  See exactly what this machine can do, then fix the one item that is blocking refunds.
                </p>
              </div>
              <Badge variant={overallReadinessLabel === 'Ready to refund' ? 'default' : 'outline'}>
                {overallReadinessLabel}
              </Badge>
            </div>
            {globalRefunds.paused && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                Paused for all machines
              </div>
            )}
            {!globalRefunds.available && !globalRefunds.paused && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Direct card refunds are unavailable. This machine's customer-intake, lookup, and capability settings are shown separately below.
              </div>
            )}
            <dl className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border bg-background text-sm">
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-muted-foreground">Customer requests</dt>
                <dd className="font-medium">{refundManagerSetup?.customerIntakeAccepting ? 'Accepting' : 'Unavailable'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-muted-foreground">Transaction lookup</dt>
                <dd className="font-medium">{refundManagerSetup?.transactionLookupReady ? 'Ready' : 'Setup needed'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-muted-foreground">Machine Managers</dt>
                <dd className="font-medium">{refundManagerSetup?.managerCount ?? machineManagerCount} assigned</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-muted-foreground">Card-refund capability</dt>
                <dd className={cn('text-right font-medium', refundManagerSetup?.nayaxRefundsEnabled && 'text-emerald-700')}>
                  {cardRefundStatus}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-muted-foreground">Direct API</dt>
                <dd className="text-right font-medium">{directApiStatus}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                <dt className="text-muted-foreground">Refund amount</dt>
                <dd className="font-medium">Exact selected transaction</dd>
              </div>
            </dl>
            {canActivateCardRefunds && refundManagerSetup?.activationEligible && !refundManagerSetup.nayaxRefundsEnabled && (
              <Button className="mt-4 w-full sm:w-auto" onClick={() => void activateCardRefunds()} disabled={isSavingMachineChanges}>
                {isActivatingCardRefunds ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Activate card-refund capability
              </Button>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {isSavingRefundReadiness ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving refund setup...
                </span>
              ) : refundReadinessSaveState === 'saved' ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved
                </span>
              ) : refundReadinessSaveState === 'error' ? (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Last change was not saved
                </span>
              ) : refundReadinessHasChanges ? (
                <span>Refund setup changes will save with the machine changes below.</span>
              ) : (
                <span>Capability status is computed by the server.</span>
              )}
            </div>
            <div className="mt-4 grid gap-4">
              <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-background px-3 py-3">
                <div className="min-w-0">
                  <Label htmlFor="refund-intake-enabled">Transaction matching</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Match customer requests to Nayax transactions. Turning this off does not stop
                    customers from asking for help.
                  </p>
                </div>
                <Switch
                  id="refund-intake-enabled"
                  checked={refundIntakeEnabled}
                  onCheckedChange={setRefundIntakeEnabled}
                  disabled={isSavingMachineChanges}
                  aria-label="Enable transaction matching for this machine"
                />
              </div>
              {refundReadinessBlocks.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Before transaction matching can be enabled:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {refundReadinessBlocks.map((block) => (
                          <li key={block}>{block}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Requests from machines without this setup still reach Bloomjoy operations for
                review. The status above is the source of truth for live card refunds.
              </p>
            </div>
          </div>
          </>
        )}
        </>}
        </>}
        {importedSource && !machine && !committedImportedMachineId && !sourceReaderOccupied && sourceStateDraft !== 'inactive' && <p role="status" className="mt-4 text-sm text-muted-foreground">{stateOnlySave ? '' : !form.accountId ? 'Choose a company before saving.' : !form.locationTimezone.trim() ? 'Choose a machine time zone before saving.' : sourceInventoryId && !sourceMoveVerified ? sourceReaderPreview.isError ? 'Reader ownership could not be checked. Retry before saving.' : 'Checking reader ownership before saving…' : ''}</p>}
        {importedSource && !machine && !committedImportedMachineId && !sourceReaderOccupied && !stateOnlySave && sourceStateDraft !== 'inactive' && sourceInventoryId && form.locationTimezone && sourceReaderPreview.isError && <Button variant="outline" className="min-h-11 text-base" onClick={() => void sourceReaderPreview.refetch()}>Retry reader check</Button>}
        {importedSource && !machine && !committedImportedMachineId && !sourceReaderOccupied && !stateOnlySave && sourceStateDraft !== 'inactive' && form.accountId && !form.locationTimezone.trim() && <Button variant="outline" className="min-h-11 text-base" onClick={() => { const field = document.getElementById('machine-timezone'); field?.scrollIntoView({ block: 'center' }); field?.focus(); field?.click(); }}>Choose time zone</Button>}
        <div className="sticky bottom-0 mt-6 flex flex-wrap justify-end gap-2 border-t bg-background py-4" aria-label="Machine changes">
          <Button variant="outline" onClick={() => { if (confirmDiscardPendingChanges()) { discardAllPendingChanges(); onOpenChange(false); } }}>
            Cancel
          </Button>
          <Button className="min-h-11 text-base" key={committedImportedMachineId ? 'retry-source-load' : stateOnlySave ? 'save-source-state' : sourceReaderOccupied && !reviewSourceReaderMove ? 'save-existing-machine' : 'save-machine'} onClick={() => void (sourceReaderOccupied && !reviewSourceReaderMove && !committedImportedMachineId && !stateOnlySave ? reuseExistingMachine() : saveMachine('all'))} disabled={committedImportedMachineId ? isSavingMachineChanges : stateOnlySave ? isSavingMachineChanges || stateInventory.isError || stateInventory.isFetching : sourceReaderOccupied && !reviewSourceReaderMove ? !sourceReuseVerified || !sourceReuseOption?.eligible || !reuseConfirmed || isSaving : (sourceReaderOccupied && (!reviewSourceReaderMove || !sourceMoveVerified || !sourceReaderMoveConfirmed || !sourceReaderChangedAt)) || (Boolean(importedSource && !machine && sourceInventoryId) && !sourceMoveVerified) || mappingHasChanges || isSavingMachineChanges || !form.machineType || isLocalDemoMode}>
            {isSavingMachineChanges ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {committedImportedMachineId ? 'Retry loading' : 'Save'}
          </Button>
        </div>
        {mappingHasChanges && <p className="mt-2 text-sm text-muted-foreground">Save Nayax match above before saving other machine changes.</p>}
    </>
  );

  if (mode === 'page') {
    return <div className="mx-auto max-w-3xl pb-12" data-machine-editor="page">
      <Link to={backHref} onClick={(event) => { if (!confirmDiscardPendingChanges()) event.preventDefault(); }} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to machines</Link>
      {editorContents}
    </div>;
  }
  return <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !confirmDiscardPendingChanges()) return; if (!nextOpen) discardAllPendingChanges(); onOpenChange(nextOpen); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={(event) => { if (event.target instanceof HTMLElement && event.target.id.endsWith('-new-company')) event.preventDefault(); }}>
      <SheetHeader className="sr-only"><SheetTitle>New Manual Machine</SheetTitle><SheetDescription>Create a manually managed machine.</SheetDescription></SheetHeader>
      {editorContents}
    </SheetContent>
  </Sheet>;
}
