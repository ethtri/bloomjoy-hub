import {
  lazy,
  Suspense,
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  MapPin,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  emptyReportingAccessContext,
  exportSalesReportPdf,
  fetchReportingAccessContext,
  fetchReportingDimensions,
  fetchSalesReport,
  summarizeSalesReport,
  type PaymentMethod,
  type ReportGrain,
  type ReportingAccessContext,
  type SalesReportFilters,
  type SalesReportRow,
} from '@/lib/reporting';
import {
  exportPartnerDashboardReport,
  fetchPartnerDashboardPartnerships,
  fetchPartnerDashboardPeriodPreview,
  type PartnerDashboardExportFormat,
  type PartnerDashboardMachinePeriod,
  type PartnerDashboardPeriodMode,
  type PartnerDashboardPartnershipOption,
  type PartnerDashboardPeriod,
  type PartnerDashboardPeriodGrain,
  type PartnerDashboardPeriodPreview,
  type PartnerDashboardWarning,
  type PartnerDashboardTotals,
} from '@/lib/partnerDashboardReporting';
import type { TranslationKey } from '@/lib/i18n';
import {
  closeReservedSignedExportWindow,
  openSignedExportUrl,
  reserveSignedExportWindow,
} from '@/lib/signedExportWindow';
import { cn } from '@/lib/utils';

type ReportingView = 'operator' | 'partner';
type OperatorPeriodPreset =
  | 'today'
  | 'last_7_days'
  | 'this_week'
  | 'last_week'
  | 'last_30_days'
  | 'month_to_date'
  | 'custom';
type OperatorDailySalesRow = {
  key: string;
  label: string;
  netSalesCents: number;
  grossSalesCents: number;
  refundAmountCents: number;
  transactionCount: number;
};
type OperatorFreshnessState = 'fresh' | 'stale' | 'unavailable';
type PartnerPeriodMode = PartnerDashboardPeriodMode;
type PartnerPeriodOption = {
  key: string;
  mode: PartnerPeriodMode;
  label: string;
  dateFrom: string;
  dateTo: string;
  periodGrain: PartnerDashboardPeriodGrain;
  isInProgress: boolean;
};
type PartnerMachineComparisonRow = {
  current: PartnerDashboardMachinePeriod;
  previous?: PartnerDashboardMachinePeriod;
};
type PartnerMachineHistoryRow = {
  period: PartnerDashboardPeriod;
  previous?: PartnerDashboardPeriod;
  isCurrent: boolean;
};
type PartnerMachineOption = {
  id: string;
  label: string;
  locationName: string | null;
  displayLabel: string;
};

const PartnerPrintableReport = lazy(
  () => import('@/components/portal/reports/PartnerPrintableReport')
);

const ALL_PARTNER_MACHINES = 'all';
const PARTNER_MACHINE_SEARCH_THRESHOLD = 6;
const PARTNER_REVENUE_SHARE_LABEL = 'Partner Revenue Share';
const PARTNER_REPORT_UNAVAILABLE_TITLE = 'Partner report unavailable';
const PARTNER_REPORT_UNAVAILABLE_DESCRIPTION =
  'We could not load partner reporting for this account right now.';
const PARTNER_REPORT_UNAVAILABLE_REASONS = [
  'Refresh the page or try again later.',
  'If access was just updated, sign out and sign back in before retrying.',
];
const PARTNER_REPORT_DATA_INCOMPLETE_TITLE = 'Report data incomplete';
const PARTNER_REPORT_EXPORT_BLOCKED_MESSAGE =
  'Export is unavailable because required report data is incomplete. Try again later.';

const isReportingTabWarning = (warning: PartnerDashboardWarning) =>
  warning.severity === 'blocking';

const paymentMethods: PaymentMethod[] = ['cash', 'credit', 'other', 'unknown'];
const paymentMethodLabelKeys: Record<PaymentMethod, TranslationKey> = {
  cash: 'reports.cash',
  credit: 'reports.credit',
  other: 'reports.other',
  unknown: 'reports.unknown',
};

const partnerNetSalesChartConfig = {
  netSales: { label: 'Net sales', color: 'hsl(var(--sage))' },
} satisfies ChartConfig;

const moneyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const exactMoneyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat();

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value: string) => new Date(`${value}T00:00:00`);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const startOfOperatorWeek = (date: Date) => {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
};

const getOperatorPresetRange = (preset: OperatorPeriodPreset) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === 'today') {
    return { dateFrom: toDateInput(today), dateTo: toDateInput(today), grain: 'day' as ReportGrain };
  }

  if (preset === 'last_7_days') {
    return {
      dateFrom: toDateInput(addDays(today, -6)),
      dateTo: toDateInput(today),
      grain: 'day' as ReportGrain,
    };
  }

  if (preset === 'this_week') {
    return { dateFrom: toDateInput(startOfOperatorWeek(today)), dateTo: toDateInput(today), grain: 'day' as ReportGrain };
  }

  if (preset === 'last_week') {
    const thisWeekStart = startOfOperatorWeek(today);
    const lastWeekStart = addDays(thisWeekStart, -7);
    return {
      dateFrom: toDateInput(lastWeekStart),
      dateTo: toDateInput(addDays(lastWeekStart, 6)),
      grain: 'day' as ReportGrain,
    };
  }

  if (preset === 'month_to_date') {
    return { dateFrom: toDateInput(startOfMonth(today)), dateTo: toDateInput(today), grain: 'day' as ReportGrain };
  }

  return {
    dateFrom: toDateInput(addDays(today, -30)),
    dateTo: toDateInput(today),
    grain: 'week' as ReportGrain,
  };
};

const getTodayForTimezone = (timezone: string | undefined) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!timezone) return today;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);

    if (!year || !month || !day) return today;
    return new Date(year, month - 1, day);
  } catch {
    return today;
  }
};

const getLastCompletedWeekEnd = (weekEndDay: number, timezone?: string) => {
  const today = getTodayForTimezone(timezone);
  let daysSinceWeekEnd = (today.getDay() - weekEndDay + 7) % 7;
  if (daysSinceWeekEnd === 0) daysSinceWeekEnd = 7;
  return addDays(today, -daysSinceWeekEnd);
};

const getPartnerPeriodKey = (
  mode: PartnerPeriodMode,
  periodGrain: PartnerDashboardPeriodGrain,
  dateFrom: string,
  dateTo: string
) => `${mode}:${periodGrain}:${dateFrom}:${dateTo}`;

const getPartnerPeriodOptions = (
  partnership: PartnerDashboardPartnershipOption | undefined,
  mode: PartnerPeriodMode
): PartnerPeriodOption[] => {
  if (!partnership) return [];

  if (mode === 'weekly') {
    const lastWeekEnd = getLastCompletedWeekEnd(
      partnership.reportingWeekEndDay,
      partnership.timezone
    );

    return Array.from({ length: 8 }, (_, index) => {
      const weekEnd = addDays(lastWeekEnd, index * -7);
      const weekStart = addDays(weekEnd, -6);
      const dateFrom = toDateInput(weekStart);
      const dateTo = toDateInput(weekEnd);
      const periodGrain = 'reporting_week' as PartnerDashboardPeriodGrain;

      return {
        key: getPartnerPeriodKey(mode, periodGrain, dateFrom, dateTo),
        mode,
        label: formatPartnerPeriod({ periodStart: dateFrom, periodEnd: dateTo }, mode),
        dateFrom,
        dateTo,
        periodGrain,
        isInProgress: false,
      };
    });
  }

  const today = getTodayForTimezone(partnership.timezone);
  const currentMonthStart = startOfMonth(today);

  if (mode === 'month_to_date') {
    const dateFrom = toDateInput(currentMonthStart);
    const dateTo = toDateInput(today);
    const periodGrain = 'calendar_month' as PartnerDashboardPeriodGrain;

    return [{
      key: getPartnerPeriodKey(mode, periodGrain, dateFrom, dateTo),
      mode,
      label: formatPartnerPeriod({ periodStart: dateFrom, periodEnd: dateTo }, mode),
      dateFrom,
      dateTo,
      periodGrain,
      isInProgress: true,
    }];
  }

  const lastCompletedMonthEnd = addDays(currentMonthStart, -1);
  const lastCompletedMonthStart = startOfMonth(lastCompletedMonthEnd);

  return Array.from({ length: 6 }, (_, index) => {
    const monthStart = addMonths(lastCompletedMonthStart, index * -1);
    const monthEnd = endOfMonth(monthStart);
    const dateFrom = toDateInput(monthStart);
    const dateTo = toDateInput(monthEnd);
    const periodGrain = 'calendar_month' as PartnerDashboardPeriodGrain;

    return {
      key: getPartnerPeriodKey(mode, periodGrain, dateFrom, dateTo),
      mode,
      label: formatPartnerPeriod({ periodStart: dateFrom, periodEnd: dateTo }, mode),
      dateFrom,
      dateTo,
      periodGrain,
      isInProgress: false,
    };
  });
};

const getPartnerTrendRange = (period: PartnerPeriodOption | undefined) => {
  if (!period) return null;

  const selectedStart = parseDateInput(period.dateFrom);
  const trendStart =
    period.mode === 'weekly'
      ? addDays(selectedStart, -49)
      : startOfMonth(addMonths(selectedStart, -5));

  return {
    dateFrom: toDateInput(trendStart),
    dateTo: period.dateTo,
    periodGrain: period.periodGrain,
  };
};

const emptyPartnerTotals = (): PartnerDashboardTotals => ({
  orderCount: 0,
  itemQuantity: 0,
  grossSalesCents: 0,
  refundAmountCents: 0,
  taxCents: 0,
  feeCents: 0,
  costCents: 0,
  netSalesCents: 0,
  splitBaseCents: 0,
  amountOwedCents: 0,
  bloomjoyRetainedCents: 0,
});

const sumPartnerTotals = (
  totals: PartnerDashboardTotals,
  period: PartnerDashboardTotals
): PartnerDashboardTotals => ({
  orderCount: totals.orderCount + period.orderCount,
  itemQuantity: totals.itemQuantity + period.itemQuantity,
  grossSalesCents: totals.grossSalesCents + period.grossSalesCents,
  refundAmountCents: totals.refundAmountCents + period.refundAmountCents,
  taxCents: totals.taxCents + period.taxCents,
  feeCents: totals.feeCents + period.feeCents,
  costCents: totals.costCents + period.costCents,
  netSalesCents: totals.netSalesCents + period.netSalesCents,
  splitBaseCents: totals.splitBaseCents + period.splitBaseCents,
  amountOwedCents: totals.amountOwedCents + period.amountOwedCents,
  bloomjoyRetainedCents: totals.bloomjoyRetainedCents + period.bloomjoyRetainedCents,
});

const periodMatchesOption = (
  period: Pick<PartnerDashboardPeriod, 'periodStart' | 'periodEnd'>,
  option: PartnerPeriodOption | undefined
) => {
  if (!option) return false;
  if (option.mode === 'month_to_date') return period.periodStart === option.dateFrom;
  return period.periodStart === option.dateFrom && period.periodEnd === option.dateTo;
};

const aggregateMachinePeriods = ({
  machinePeriods,
  periodStart,
  periodEnd,
  machineId,
}: {
  machinePeriods: PartnerDashboardMachinePeriod[];
  periodStart: string;
  periodEnd: string;
  machineId: string;
}): PartnerDashboardPeriod => {
  const summary = machinePeriods
    .filter((period) => period.reportingMachineId === machineId)
    .reduce(sumPartnerTotals, emptyPartnerTotals());

  return {
    periodStart,
    periodEnd,
    ...summary,
  };
};

const normalizePeriodForOption = (
  period: PartnerDashboardPeriod | undefined,
  option: PartnerPeriodOption | undefined
): PartnerDashboardPeriod | undefined => {
  if (!period || !option) return period;

  return {
    ...period,
    periodStart: option.dateFrom,
    periodEnd: option.dateTo,
  };
};

const getPartnerModeLabel = (periodMode: PartnerPeriodMode) => {
  if (periodMode === 'weekly') return 'Weekly';
  if (periodMode === 'month_to_date') return 'Month to date';
  return 'Completed month';
};

const getPartnerPeriodSelectLabel = (periodMode: PartnerPeriodMode) =>
  periodMode === 'month_to_date' ? 'Current period' : 'Completed period';

const getPartnerPeriodPlaceholder = (periodMode: PartnerPeriodMode) => {
  if (periodMode === 'weekly') return 'Select week';
  if (periodMode === 'month_to_date') return 'Current month to date';
  return 'Select month';
};

const getPartnerExportPeriodLabel = (period: PartnerPeriodOption | undefined) => {
  if (!period) return '';
  if (period.mode === 'month_to_date') {
    return `Month to date: ${formatDate(period.dateFrom)} through ${formatDate(period.dateTo)}`;
  }

  return formatPartnerPeriod({ periodStart: period.dateFrom, periodEnd: period.dateTo }, period.mode);
};

const getPartnerComparisonNoun = (periodMode: PartnerPeriodMode) =>
  periodMode === 'weekly' ? 'week' : 'month';

const getPartnerPeriodNoun = (periodMode: PartnerPeriodMode) =>
  periodMode === 'weekly' ? 'week' : 'month';

const formatCurrency = (cents: number, exact = false) =>
  (exact ? exactMoneyFormatter : moneyFormatter).format(cents / 100);

const formatDate = (value: string | null | undefined) =>
  value
    ? parseDateInput(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'n/a';

const formatShortDate = (value: string) =>
  parseDateInput(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const formatMonth = (value: string) =>
  parseDateInput(value).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const formatDateRange = (start: string | undefined, end: string | undefined) =>
  start && end ? `${formatShortDate(start)} - ${formatShortDate(end)}` : 'No period selected';

const formatPartnerPeriod = (
  period: Pick<PartnerDashboardPeriod, 'periodStart' | 'periodEnd'>,
  periodMode: PartnerPeriodMode
) => {
  if (periodMode === 'weekly') return formatDateRange(period.periodStart, period.periodEnd);
  if (periodMode === 'month_to_date') return `${formatDateRange(period.periodStart, period.periodEnd)} MTD`;
  return formatMonth(period.periodStart);
};

const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'not available';

const formatPercentChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 'New activity' : 'No change';
  const value = ((current - previous) / previous) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const periodVolume = (period: PartnerDashboardTotals | undefined) =>
  period ? period.itemQuantity || period.orderCount : 0;

const hasAdditionalCosts = (period: PartnerDashboardTotals | undefined) =>
  (period?.costCents ?? 0) > 0;

const usesNetSalesAsPayoutBasis = (period: PartnerDashboardTotals | undefined) =>
  !period || period.splitBaseCents === period.netSalesCents;

const shouldShowPayoutBasisColumn = (rows: PartnerMachineComparisonRow[]) =>
  rows.some((row) => !usesNetSalesAsPayoutBasis(row.current));

const shouldShowPeriodPayoutBasisColumn = (periods: PartnerDashboardTotals[]) =>
  periods.some((period) => !usesNetSalesAsPayoutBasis(period));

const formatPayoutBasisDetail = (period: PartnerDashboardTotals) =>
  usesNetSalesAsPayoutBasis(period)
    ? 'Payout basis'
    : `Payout basis ${formatCurrency(period.splitBaseCents, true)}`;

const formatTaxDeductionsDetail = (period: PartnerDashboardTotals) =>
  hasAdditionalCosts(period)
    ? `Additional costs ${formatCurrency(period.costCents, true)}`
    : 'Tax and configured deductions';

const buildPartnerMachineOptions = (
  machinePeriods: PartnerDashboardMachinePeriod[]
): PartnerMachineOption[] => {
  const machinesById = new Map<
    string,
    Pick<PartnerMachineOption, 'id' | 'label' | 'locationName'>
  >();

  machinePeriods.forEach((machine) => {
    if (!machine.reportingMachineId) return;

    const existing = machinesById.get(machine.reportingMachineId);
    machinesById.set(machine.reportingMachineId, {
      id: machine.reportingMachineId,
      label: machine.machineLabel,
      locationName: existing?.locationName ?? machine.locationName,
    });
  });

  const machines = [...machinesById.values()].sort((left, right) =>
    left.label.localeCompare(right.label) ||
    (left.locationName ?? '').localeCompare(right.locationName ?? '') ||
    left.id.localeCompare(right.id)
  );

  return machines.map((machine) => {
    const duplicates = machines.filter((candidate) => candidate.label === machine.label);
    if (duplicates.length === 1) {
      return { ...machine, displayLabel: machine.label };
    }

    const sameLocationCount = duplicates.filter(
      (candidate) => candidate.locationName === machine.locationName
    ).length;
    if (machine.locationName && sameLocationCount === 1) {
      return { ...machine, displayLabel: `${machine.label} · ${machine.locationName}` };
    }

    const duplicateIndex = duplicates.findIndex((candidate) => candidate.id === machine.id) + 1;
    const locationPrefix = machine.locationName ? `${machine.locationName} · ` : '';
    return {
      ...machine,
      displayLabel: `${machine.label} · ${locationPrefix}Machine ${duplicateIndex}`,
    };
  });
};

const getChangeTone = (current: number, previous: number) => {
  if (current === previous) return 'text-muted-foreground';
  return current > previous ? 'text-sage' : 'text-amber';
};

const getTrendIcon = (current: number, previous: number) => {
  if (current === previous) return Info;
  return current > previous ? TrendingUp : TrendingDown;
};

const groupRows = <TKey extends string>(
  rows: SalesReportRow[],
  getKey: (row: SalesReportRow) => TKey,
  getLabel: (row: SalesReportRow) => string
) => {
  const groups = new Map<
    TKey,
    {
      key: TKey;
      label: string;
      netSalesCents: number;
      grossSalesCents: number;
      refundAmountCents: number;
      transactionCount: number;
    }
  >();

  rows.forEach((row) => {
    const key = getKey(row);
    const current =
      groups.get(key) ??
      {
        key,
        label: getLabel(row),
        netSalesCents: 0,
        grossSalesCents: 0,
        refundAmountCents: 0,
        transactionCount: 0,
      };

    current.netSalesCents += row.netSalesCents;
    current.grossSalesCents += row.grossSalesCents;
    current.refundAmountCents += row.refundAmountCents;
    current.transactionCount += row.transactionCount;
    groups.set(key, current);
  });

  return [...groups.values()].sort((left, right) => right.netSalesCents - left.netSalesCents);
};

const buildOperatorDailyRows = (
  rows: SalesReportRow[],
  dateFrom: string,
  dateTo: string
): OperatorDailySalesRow[] => {
  const startDate = parseDateInput(dateFrom);
  const endDate = parseDateInput(dateTo);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate.getTime() > endDate.getTime()
  ) {
    return [];
  }

  const totalsByDate = new Map(
    groupRows(rows, (row) => row.periodStart, (row) => formatShortDate(row.periodStart)).map((row) => [
      row.key,
      row,
    ])
  );
  const dailyRows: OperatorDailySalesRow[] = [];

  for (let date = startDate; date.getTime() <= endDate.getTime(); date = addDays(date, 1)) {
    const key = toDateInput(date);
    const totals = totalsByDate.get(key);
    dailyRows.push({
      key,
      label: formatDate(key),
      netSalesCents: totals?.netSalesCents ?? 0,
      grossSalesCents: totals?.grossSalesCents ?? 0,
      refundAmountCents: totals?.refundAmountCents ?? 0,
      transactionCount: totals?.transactionCount ?? 0,
    });
  }

  return dailyRows;
};

const isOperatorDailyRowZero = (row: OperatorDailySalesRow) =>
  row.netSalesCents === 0 &&
  row.grossSalesCents === 0 &&
  row.refundAmountCents === 0 &&
  row.transactionCount === 0;

export default function ReportsPage() {
  const { isCorporatePartner, isScopedAdmin, isSuperAdmin } = useAuth();
  const { t } = useLanguage();
  const canUsePartnerDashboard = isSuperAdmin || isScopedAdmin || isCorporatePartner;
  const [activeView, setActiveView] = useState<ReportingView>(
    isCorporatePartner ? 'partner' : 'operator'
  );
  const hasAppliedCorporatePartnerDefault = useRef(isCorporatePartner);
  const partnerDashboardLabel = isCorporatePartner ? 'Partner Dashboard' : t('reports.partnerDashboard');
  const introDescription = canUsePartnerDashboard
    ? t('reports.description')
    : t('reports.operatorDescription');

  const { data: accessContext = emptyReportingAccessContext, isFetching: accessFetching } =
    useQuery({
      queryKey: ['reporting-access-context'],
      queryFn: fetchReportingAccessContext,
      staleTime: 1000 * 60,
  });

  useEffect(() => {
    if (!canUsePartnerDashboard && activeView === 'partner') {
      setActiveView('operator');
    }
  }, [activeView, canUsePartnerDashboard]);

  useEffect(() => {
    if (!isCorporatePartner || !canUsePartnerDashboard || hasAppliedCorporatePartnerDefault.current) {
      return;
    }

    hasAppliedCorporatePartnerDefault.current = true;
    setActiveView('partner');
  }, [canUsePartnerDashboard, isCorporatePartner]);

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title={t('reports.title')}
            description={introDescription}
            badges={[
              {
                label: t('reports.machinesAvailable', {
                  count: accessContext.accessibleMachineCount,
                }),
                tone: 'muted',
              },
              {
                label: t('reports.latestSale', {
                  date: formatDate(accessContext.latestSaleDate),
                }),
                tone: 'muted',
              },
              {
                label: t('reports.lastImport', {
                  date: formatDateTime(accessContext.latestImportCompletedAt),
                }),
                tone: 'muted',
              },
              {
                label: accessFetching
                  ? t('reports.refreshing')
                  : isSuperAdmin
                    ? t('reports.superAdminReporting')
                    : isCorporatePartner
                      ? 'Corporate Partner reporting'
                    : t('reports.operatorReporting'),
                tone: isSuperAdmin || isCorporatePartner ? 'accent' : 'default',
              },
            ]}
            actions={
              canUsePartnerDashboard ? (
                <ToggleGroup
                  aria-label={t('reports.viewToggleLabel')}
                  type="single"
                  value={activeView}
                  onValueChange={(value) => {
                    if (value === 'operator' || value === 'partner') setActiveView(value);
                  }}
                  className="grid w-full grid-cols-2 rounded-lg border border-border bg-background p-1 sm:w-[340px]"
                >
                  <ToggleGroupItem value="operator" className="h-9 rounded-md text-sm">
                    {t('reports.operatorView')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="partner" className="h-9 rounded-md text-sm">
                    {partnerDashboardLabel}
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : undefined
            }
          />

          <div className="mt-6">
            {activeView === 'partner' && canUsePartnerDashboard ? (
              <PartnerDashboardView />
            ) : (
              <OperatorReportingView
                accessContext={accessContext}
                accessContextFetching={accessFetching}
              />
            )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

function OperatorReportingView({
  accessContext,
  accessContextFetching,
}: {
  accessContext: ReportingAccessContext;
  accessContextFetching: boolean;
}) {
  const { t } = useLanguage();
  const operatorChartConfig = useMemo(
    () =>
      ({
        netSales: { label: t('reports.netSales'), color: 'hsl(var(--primary))' },
      }) satisfies ChartConfig,
    [t]
  );
  const defaultRange = useMemo(() => getOperatorPresetRange('last_30_days'), []);
  const [periodPreset, setPeriodPreset] = useState<OperatorPeriodPreset>('last_30_days');
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom);
  const [dateTo, setDateTo] = useState(defaultRange.dateTo);
  const [grain, setGrain] = useState<ReportGrain>(defaultRange.grain);
  const [machineId, setMachineId] = useState('all');
  const [selectedPayments, setSelectedPayments] = useState<PaymentMethod[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const {
    data: dimensions = [],
    isLoading: dimensionsLoading,
    error: dimensionsError,
  } = useQuery({
    queryKey: ['reporting-dimensions'],
    queryFn: fetchReportingDimensions,
    staleTime: 1000 * 60,
  });

  const machineOptions = useMemo(() => dimensions, [dimensions]);

  useEffect(() => {
    if (machineId !== 'all' && !machineOptions.some((machine) => machine.machineId === machineId)) {
      setMachineId('all');
    }
  }, [machineId, machineOptions]);

  const filters: SalesReportFilters = useMemo(
    () => ({
      dateFrom,
      dateTo,
      grain,
      machineIds: machineId === 'all' ? [] : [machineId],
      paymentMethods: selectedPayments,
    }),
    [dateFrom, dateTo, grain, machineId, selectedPayments]
  );

  const {
    data: reportRows = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['sales-report', filters],
    queryFn: () => fetchSalesReport(filters),
    enabled: !dimensionsLoading,
    staleTime: 1000 * 30,
  });

  const summary = useMemo(() => summarizeSalesReport(reportRows), [reportRows]);
  const averageOrderCents =
    summary.transactionCount > 0 ? Math.round(summary.netSalesCents / summary.transactionCount) : 0;

  const dailyRows = useMemo(
    () => buildOperatorDailyRows(reportRows, dateFrom, dateTo),
    [dateFrom, dateTo, reportRows]
  );

  const operatorFreshnessState = useMemo<OperatorFreshnessState>(() => {
    if (!accessContext.latestImportCompletedAt) return 'unavailable';
    const latestImport = new Date(accessContext.latestImportCompletedAt);
    if (Number.isNaN(latestImport.getTime())) return 'unavailable';
    return toDateInput(latestImport) < dateTo ? 'stale' : 'fresh';
  }, [accessContext.latestImportCompletedAt, dateTo]);

  const chartRows = useMemo(
    () =>
      (grain === 'day'
        ? dailyRows
        : groupRows(
            reportRows,
            (row) => row.periodStart,
            (row) => formatShortDate(row.periodStart)
          ).sort((left, right) => left.key.localeCompare(right.key))
      ).map((row) => ({
        period: grain === 'day' ? formatShortDate(row.key) : row.label,
        netSales: row.netSalesCents / 100,
      })),
    [dailyRows, grain, reportRows]
  );

  const machineRows = useMemo(
    () => groupRows(reportRows, (row) => row.machineId, (row) => row.machineLabel),
    [reportRows]
  );

  const applyPeriodPreset = (preset: OperatorPeriodPreset) => {
    setPeriodPreset(preset);
    if (preset === 'custom') return;
    const nextRange = getOperatorPresetRange(preset);
    setDateFrom(nextRange.dateFrom);
    setDateTo(nextRange.dateTo);
    setGrain(nextRange.grain);
  };

  const exportPdf = async () => {
    const exportWindow = reserveSignedExportWindow();
    setIsExporting(true);
    try {
      const exportResult = await exportSalesReportPdf({
        ...filters,
        title: 'Bloomjoy Operator Sales Report',
      });
      toast.success('Polished operator report PDF is ready.');
      openSignedExportUrl(exportResult.signedUrl, exportWindow);
    } catch (exportError) {
      closeReservedSignedExportWindow(exportWindow);
      toast.error(exportError instanceof Error ? exportError.message : 'Unable to export report.');
    } finally {
      setIsExporting(false);
    }
  };

  const hasLoadError = Boolean(error || dimensionsError);

  return (
    <div className="flex flex-col gap-6">
      {hasLoadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('reports.loadErrorTitle')}</AlertTitle>
          <AlertDescription>
            {t('reports.loadErrorDescription')}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-xl">{t('reports.operatorPerformance')}</CardTitle>
              <CardDescription>
                {t('reports.operatorPerformanceDescription')}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={exportPdf}
                disabled={isExporting || reportRows.length === 0}
                className="min-h-11"
                data-portal-report-export="operator-pdf"
              >
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {t('reports.exportPdf')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label id="operator-period-label">{t('reports.period')}</Label>
              <ToggleGroup
                type="single"
                value={periodPreset}
                onValueChange={(value) => {
                  if (value) applyPeriodPreset(value as OperatorPeriodPreset);
                }}
                aria-labelledby="operator-period-label"
                className="grid grid-cols-2 items-stretch rounded-lg border border-border bg-background p-1 sm:grid-cols-4 xl:grid-cols-7"
              >
                <ToggleGroupItem value="today" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.today')}
                </ToggleGroupItem>
                <ToggleGroupItem value="last_7_days" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.last7Days')}
                </ToggleGroupItem>
                <ToggleGroupItem value="this_week" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.thisWeek')}
                </ToggleGroupItem>
                <ToggleGroupItem value="last_week" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.lastWeek')}
                </ToggleGroupItem>
                <ToggleGroupItem value="last_30_days" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.last30Days')}
                </ToggleGroupItem>
                <ToggleGroupItem value="month_to_date" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.monthToDate')}
                </ToggleGroupItem>
                <ToggleGroupItem value="custom" className="min-h-11 rounded-md px-2 text-xs sm:text-sm">
                  {t('reports.custom')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(18rem,1.5fr)]">
              <LabeledControl label={t('reports.from')}>
                <Input
                  type="date"
                  className="h-11 min-w-0"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPeriodPreset('custom');
                  }}
                />
              </LabeledControl>
              <LabeledControl label={t('reports.to')}>
                <Input
                  type="date"
                  className="h-11 min-w-0"
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPeriodPreset('custom');
                  }}
                />
              </LabeledControl>
              <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
                <Label id="operator-breakdown-label">{t('reports.breakdown')}</Label>
                <ToggleGroup
                  type="single"
                  value={grain}
                  onValueChange={(value) => {
                    if (value) setGrain(value as ReportGrain);
                  }}
                  aria-labelledby="operator-breakdown-label"
                  data-reporting-operator-breakdown
                  className="grid grid-cols-3 rounded-lg border border-border bg-background p-1"
                >
                  <ToggleGroupItem value="day" className="min-h-11 rounded-md px-2 text-sm">
                    {t('reports.daily')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="week" className="min-h-11 rounded-md px-2 text-sm">
                    {t('reports.weekly')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="month" className="min-h-11 rounded-md px-2 text-sm">
                    {t('reports.monthly')}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
            <LabeledControl label={t('reports.machine')}>
              <Select value={machineId} onValueChange={setMachineId}>
                <SelectTrigger className="h-11 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('reports.allMachines')}</SelectItem>
                    {machineOptions.map((dimension) => (
                      <SelectItem key={dimension.machineId} value={dimension.machineId}>
                        {dimension.machineLabel}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </LabeledControl>

            <div className="flex flex-col gap-2">
              <Label id="operator-payment-label">{t('reports.payment')}</Label>
              <ToggleGroup
                type="multiple"
                value={selectedPayments}
                onValueChange={(value) => setSelectedPayments(value as PaymentMethod[])}
                aria-labelledby="operator-payment-label"
                className="grid grid-cols-2 rounded-lg border border-border bg-background p-1 sm:grid-cols-4"
              >
                {paymentMethods.map((paymentMethod) => (
                  <ToggleGroupItem
                    key={paymentMethod}
                    value={paymentMethod}
                    className="min-h-11 rounded-md text-sm"
                  >
                    {t(paymentMethodLabelKeys[paymentMethod])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        data-reporting-operator-metrics
      >
        {isLoading ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              label={t('reports.netSales')}
              value={formatCurrency(summary.netSalesCents, true)}
              context={t('reports.averageOrder', { value: formatCurrency(averageOrderCents, true) })}
            />
            <MetricCard
              label={t('reports.grossSales')}
              value={formatCurrency(summary.grossSalesCents, true)}
              context={t('reports.netPlusRefunds')}
            />
            <MetricCard
              label={t('reports.refundImpact')}
              value={formatCurrency(summary.refundAmountCents, true)}
              context={t('reports.addedBackGross')}
            />
            <MetricCard
              label={t('reports.transactions')}
              value={numberFormatter.format(summary.transactionCount)}
              context={t('reports.assignedMachines', { count: dimensions.length })}
            />
          </>
        )}
      </div>

      {grain === 'day' && (
        <Card className="min-w-0" data-reporting-operator-daily-sales>
          <CardHeader className="gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-xl">{t('reports.dailySales')}</CardTitle>
                <CardDescription>{t('reports.dailySalesDescription')}</CardDescription>
              </div>
              <Badge
                variant="outline"
                className="max-w-full whitespace-normal text-left font-normal leading-snug sm:w-fit sm:shrink-0"
                data-reporting-operator-freshness-state={operatorFreshnessState}
              >
                {accessContextFetching
                  ? t('reports.checkingImportFreshness')
                  : operatorFreshnessState === 'unavailable'
                    ? t('reports.importFreshnessUnavailable')
                    : t('reports.lastImport', {
                        date: formatDateTime(accessContext.latestImportCompletedAt),
                      })}
              </Badge>
            </div>
            {isFetching && !isLoading && (
              <div className="text-sm text-muted-foreground" role="status">
                {t('reports.updatingDailyTotals')}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading || accessContextFetching ? (
              <div className="space-y-3" aria-label="Loading daily sales">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : hasLoadError ? (
              <EmptyPanel
                title={t('reports.dailySalesUnavailable')}
                description={t('reports.dailySalesUnavailableDescription')}
              />
            ) : dailyRows.length === 0 ? (
              <EmptyPanel
                title={t('reports.chooseValidDateRange')}
                description={t('reports.chooseValidDateRangeDescription')}
              />
            ) : (
              <>
                {operatorFreshnessState !== 'fresh' && (
                  <Alert className="mb-4 border-amber/40 bg-amber/5">
                    <Info className="h-4 w-4 text-amber" />
                    <AlertTitle>
                      {operatorFreshnessState === 'stale'
                        ? t('reports.selectedRangeBeyondImport')
                        : t('reports.importFreshnessUnavailable')}
                    </AlertTitle>
                    <AlertDescription>
                      {t('reports.loadedTotalsIncomplete')}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-col gap-3 md:hidden">
                  {dailyRows.map((row) => (
                    <OperatorDailySalesMobileCard key={row.key} row={row} />
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('reports.date')}</TableHead>
                        <TableHead>{t('reports.status')}</TableHead>
                        <TableHead className="text-right">{t('reports.netSales')}</TableHead>
                        <TableHead className="text-right">{t('reports.grossSales')}</TableHead>
                        <TableHead className="text-right">{t('reports.refundImpact')}</TableHead>
                        <TableHead className="text-right">{t('reports.transactions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyRows.map((row) => (
                        <TableRow
                          key={row.key}
                          data-reporting-daily-row
                          data-date={row.key}
                        >
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="whitespace-nowrap font-normal">
                              {isOperatorDailyRowZero(row)
                                ? t('reports.noSalesLoaded')
                                : t('reports.salesRecorded')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(row.netSalesCents, true)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(row.grossSalesCents, true)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(row.refundAmountCents, true)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {numberFormatter.format(row.transactionCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t('reports.salesTrend')}</CardTitle>
            <CardDescription>
              {t('reports.salesTrendDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : chartRows.length === 0 ? (
              <EmptyPanel title={t('reports.noSalesFound')} description={t('reports.noSalesDescription')} />
            ) : (
              <ChartContainer
                config={operatorChartConfig}
                className="!aspect-auto h-[260px] w-full max-w-full sm:h-[320px]"
              >
                <BarChart data={chartRows}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={56} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="netSales"
                    fill="var(--color-netSales)"
                    radius={[5, 5, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t('reports.machineComparison')}</CardTitle>
            <CardDescription>
              {t('reports.machineComparisonDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {machineRows.length === 0 ? (
              <EmptyPanel title={t('reports.noMachineRows')} description={t('reports.noMachineRowsDescription')} />
            ) : (
              <div className="flex flex-col gap-3">
                {machineRows.slice(0, 6).map((row) => (
                  <MachineSummaryRow
                    key={row.key}
                    label={row.label}
                    context={`${row.transactionCount.toLocaleString()} ${t('reports.transactions').toLowerCase()}`}
                    primary={formatCurrency(row.netSalesCents, true)}
                    secondary={`${t('reports.grossSales')} ${formatCurrency(row.grossSalesCents, true)}`}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-xl">{t('reports.reportRows')}</CardTitle>
          <CardDescription>
            {t('reports.reportRowsDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reportRows.length === 0 ? (
            <EmptyPanel title={t('reports.noRowsFound')} description={t('reports.noRowsDescription')} />
          ) : (
            <>
              <div className="flex flex-col gap-3 md:hidden">
                {reportRows.map((row) => (
                  <OperatorReportRowMobileCard
                    key={`${row.periodStart}-${row.machineId}-${row.paymentMethod}`}
                    row={row}
                  />
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('reports.period')}</TableHead>
                      <TableHead>{t('reports.machine')}</TableHead>
                      <TableHead>{t('reports.payment')}</TableHead>
                      <TableHead className="text-right">{t('reports.netSales')}</TableHead>
                      <TableHead className="text-right">{t('reports.grossSales')}</TableHead>
                      <TableHead className="text-right">{t('reports.refundImpact')}</TableHead>
                      <TableHead className="text-right">{t('reports.transactions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportRows.map((row) => (
                      <TableRow key={`${row.periodStart}-${row.machineId}-${row.paymentMethod}`}>
                        <TableCell>{formatDate(row.periodStart)}</TableCell>
                        <TableCell className="font-medium">{row.machineLabel}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {t(paymentMethodLabelKeys[row.paymentMethod])}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.netSalesCents, true)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.grossSalesCents, true)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(row.refundAmountCents, true)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormatter.format(row.transactionCount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
        {t('reports.updatedAt', {
          date: formatDateTime(accessContext.latestImportCompletedAt),
        })}
      </div>
    </div>
  );
}

type PartnerDashboardUnavailableStateProps = {
  title: string;
  description: string;
  reasons: string[];
  action?: ReactNode;
  tone?: 'default' | 'destructive';
};

function PartnerDashboardUnavailableState({
  title,
  description,
  reasons,
  action,
  tone = 'default',
}: PartnerDashboardUnavailableStateProps) {
  return (
    <Card
      className={cn(
        'border-primary/15 bg-primary/5',
        tone === 'destructive' && 'border-destructive/30 bg-destructive/5'
      )}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="text-sm leading-6 text-foreground">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {action && <div>{action}</div>}
      </CardContent>
    </Card>
  );
}

function PartnerDashboardView() {
  const { isCorporatePartner, isScopedAdmin, isSuperAdmin } = useAuth();
  const canSeeInternalPartnerWarnings = isSuperAdmin || isScopedAdmin;
  const [periodMode, setPeriodMode] = useState<PartnerPeriodMode>('weekly');
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');
  const [selectedPartnershipId, setSelectedPartnershipId] = useState('');
  const [selectedMachineId, setSelectedMachineId] = useState(ALL_PARTNER_MACHINES);
  const machinePickerRef = useRef<HTMLButtonElement>(null);
  const machineScopeRef = useRef<HTMLElement>(null);
  const shouldFocusMachineScopeRef = useRef(false);
  const [exportingPartnerFormat, setExportingPartnerFormat] =
    useState<PartnerDashboardExportFormat | null>(null);

  const {
    data: partnerships = [],
    isLoading: partnershipsLoading,
    error: partnershipsError,
  } = useQuery({
    queryKey: ['partner-dashboard-partnerships'],
    queryFn: fetchPartnerDashboardPartnerships,
    staleTime: 1000 * 60,
  });

  useEffect(() => {
    if (!selectedPartnershipId && partnerships.length > 0) {
      setSelectedPartnershipId(partnerships[0].id);
    }
  }, [partnerships, selectedPartnershipId]);

  const selectedPartnership = partnerships.find(
    (partnership) => partnership.id === selectedPartnershipId
  );

  useEffect(() => {
    setSelectedMachineId(ALL_PARTNER_MACHINES);
  }, [selectedPartnershipId]);

  const periodOptions = useMemo(
    () => getPartnerPeriodOptions(selectedPartnership, periodMode),
    [periodMode, selectedPartnership]
  );

  useEffect(() => {
    if (periodOptions.length === 0) {
      if (selectedPeriodKey) setSelectedPeriodKey('');
      return;
    }

    if (!periodOptions.some((period) => period.key === selectedPeriodKey)) {
      setSelectedPeriodKey(periodOptions[0].key);
    }
  }, [periodOptions, selectedPeriodKey]);

  const selectedPeriod =
    periodOptions.find((period) => period.key === selectedPeriodKey) ?? periodOptions[0];

  const trendRange = useMemo(() => getPartnerTrendRange(selectedPeriod), [selectedPeriod]);

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: selectedPreviewFetching,
    error: previewError,
  } = useQuery({
    queryKey: [
      'partner-dashboard-period-preview',
      'selected',
      selectedPartnershipId,
      selectedPeriod?.periodGrain,
      selectedPeriod?.dateFrom,
      selectedPeriod?.dateTo,
    ],
    queryFn: () => {
      if (!selectedPeriod) {
        throw new Error('Select a completed reporting period.');
      }

      return fetchPartnerDashboardPeriodPreview({
        partnershipId: selectedPartnershipId,
        dateFrom: selectedPeriod.dateFrom,
        dateTo: selectedPeriod.dateTo,
        periodGrain: selectedPeriod.periodGrain,
      });
    },
    enabled: Boolean(selectedPartnershipId && selectedPeriod),
    staleTime: 1000 * 30,
  });

  const {
    data: trendPreview,
    isFetching: trendPreviewFetching,
    error: trendPreviewError,
  } = useQuery({
    queryKey: [
      'partner-dashboard-period-preview',
      'trend',
      selectedPartnershipId,
      trendRange?.periodGrain,
      trendRange?.dateFrom,
      trendRange?.dateTo,
    ],
    queryFn: () => {
      if (!trendRange) {
        throw new Error('Select a completed reporting period.');
      }

      return fetchPartnerDashboardPeriodPreview({
        partnershipId: selectedPartnershipId,
        dateFrom: trendRange.dateFrom,
        dateTo: trendRange.dateTo,
        periodGrain: trendRange.periodGrain,
      });
    },
    enabled: Boolean(selectedPartnershipId && trendRange),
    staleTime: 1000 * 30,
  });

  const selectedPreviewPeriod = useMemo(
    () =>
      normalizePeriodForOption(
        preview?.periods.find((period) => periodMatchesOption(period, selectedPeriod)) ??
          preview?.periods[0],
        selectedPeriod
      ),
    [preview?.periods, selectedPeriod]
  );

  const trendPeriods = useMemo(
    () =>
      [...(trendPreview?.periods ?? [])].sort((left, right) =>
        left.periodStart.localeCompare(right.periodStart)
      ),
    [trendPreview?.periods]
  );

  const machineOptions = useMemo(() => {
    return buildPartnerMachineOptions(preview?.machinePeriods ?? []);
  }, [preview?.machinePeriods]);

  const machineOptionsById = useMemo(
    () => new Map(machineOptions.map((machine) => [machine.id, machine])),
    [machineOptions]
  );

  useEffect(() => {
    if (previewLoading || selectedPreviewFetching || !preview) return;

    if (
      selectedMachineId !== ALL_PARTNER_MACHINES &&
      !machineOptions.some((machine) => machine.id === selectedMachineId)
    ) {
      setSelectedMachineId(ALL_PARTNER_MACHINES);
    }
  }, [
    machineOptions,
    preview,
    previewLoading,
    selectedMachineId,
    selectedPreviewFetching,
  ]);

  const selectedMachine = machineOptions.find((machine) => machine.id === selectedMachineId);
  const selectedMachineLabel = selectedMachine?.displayLabel;
  const scopedMachineIds =
    selectedMachineId === ALL_PARTNER_MACHINES ? [] : [selectedMachineId];

  useEffect(() => {
    if (!selectedMachine || !shouldFocusMachineScopeRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      const scope = machineScopeRef.current;
      if (!scope) return;

      scope.focus({ preventScroll: true });
      scope.scrollIntoView({ behavior: 'instant', block: 'start' });
      shouldFocusMachineScopeRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedMachine]);

  const selectMachineScope = (machineId: string) => {
    shouldFocusMachineScopeRef.current = machineId !== ALL_PARTNER_MACHINES;
    setSelectedMachineId(machineId);
  };

  const clearMachineScope = () => {
    shouldFocusMachineScopeRef.current = false;
    setSelectedMachineId(ALL_PARTNER_MACHINES);
    window.requestAnimationFrame(() => machinePickerRef.current?.focus());
  };

  const currentPeriod = useMemo(() => {
    if (!selectedPeriod) return selectedPreviewPeriod;
    if (selectedMachineId === ALL_PARTNER_MACHINES) return selectedPreviewPeriod;

    return aggregateMachinePeriods({
      machinePeriods: (preview?.machinePeriods ?? []).filter((period) =>
        periodMatchesOption(period, selectedPeriod)
      ),
      periodStart: selectedPeriod.dateFrom,
      periodEnd: selectedPeriod.dateTo,
      machineId: selectedMachineId,
    });
  }, [
    preview?.machinePeriods,
    selectedMachineId,
    selectedPeriod,
    selectedPreviewPeriod,
  ]);

  const previousPeriodWindow = useMemo(() => {
    if (!selectedPeriod) return undefined;
    const priorPeriods = trendPeriods.filter(
      (period) => period.periodStart < selectedPeriod.dateFrom
    );
    return priorPeriods[priorPeriods.length - 1];
  }, [selectedPeriod, trendPeriods]);

  const previousPeriod = useMemo(() => {
    if (!previousPeriodWindow) return undefined;
    if (selectedMachineId === ALL_PARTNER_MACHINES) return previousPeriodWindow;

    return aggregateMachinePeriods({
      machinePeriods: (trendPreview?.machinePeriods ?? []).filter(
        (period) => period.periodStart === previousPeriodWindow.periodStart
      ),
      periodStart: previousPeriodWindow.periodStart,
      periodEnd: previousPeriodWindow.periodEnd,
      machineId: selectedMachineId,
    });
  }, [previousPeriodWindow, selectedMachineId, trendPreview?.machinePeriods]);

  const displayPeriods = useMemo(
    () => {
      const periodRows =
        selectedMachineId === ALL_PARTNER_MACHINES
          ? trendPeriods
          : trendPeriods.map((period) =>
              aggregateMachinePeriods({
                machinePeriods: (trendPreview?.machinePeriods ?? []).filter(
                  (machinePeriod) => machinePeriod.periodStart === period.periodStart
                ),
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,
                machineId: selectedMachineId,
              })
            );

      if (!currentPeriod) return periodRows;
      if (periodRows.length === 0) return [currentPeriod];

      let includesSelectedPeriod = false;
      const periods = periodRows.map((period) => {
        const isSelectedPeriod = selectedPeriod
          ? periodMatchesOption(period, selectedPeriod)
          : period.periodStart === currentPeriod.periodStart &&
            period.periodEnd === currentPeriod.periodEnd;
        if (isSelectedPeriod) {
          includesSelectedPeriod = true;
          return currentPeriod;
        }
        return period;
      });

      if (includesSelectedPeriod) return periods;

      return [...periods, currentPeriod].sort((left, right) =>
        left.periodStart.localeCompare(right.periodStart)
      );
    },
    [currentPeriod, selectedMachineId, selectedPeriod, trendPeriods, trendPreview?.machinePeriods]
  );

  const machineRows = useMemo(
    () => buildPartnerMachineRows(preview, currentPeriod, previousPeriod, trendPreview),
    [currentPeriod, preview, previousPeriod, trendPreview]
  );
  const showPayoutBasisColumn = shouldShowPayoutBasisColumn(machineRows);
  const machineHistoryRows = useMemo<PartnerMachineHistoryRow[]>(
    () =>
      displayPeriods.map((period, index) => ({
        period,
        previous: index > 0 ? displayPeriods[index - 1] : undefined,
        isCurrent: selectedPeriod
          ? periodMatchesOption(period, selectedPeriod)
          : currentPeriod
            ? period.periodStart === currentPeriod.periodStart &&
              period.periodEnd === currentPeriod.periodEnd
            : false,
      })),
    [currentPeriod, displayPeriods, selectedPeriod]
  );
  const showHistoryPayoutBasisColumn = shouldShowPeriodPayoutBasisColumn(displayPeriods);

  const netSalesTrendData = useMemo(
    () =>
      displayPeriods.map((period) => ({
        period: formatPartnerPeriod(period, periodMode),
        netSales: period.netSalesCents / 100,
      })),
    [displayPeriods, periodMode]
  );

  const blockingWarnings = useMemo(
    () =>
      (preview?.warnings ?? [])
        .filter(
          (warning) =>
            selectedMachineId === ALL_PARTNER_MACHINES ||
            !warning.machineId ||
            warning.machineId === selectedMachineId
        )
        .filter(isReportingTabWarning),
    [preview?.warnings, selectedMachineId]
  );
  const nonBlockingWarnings = useMemo(
    () =>
      (preview?.warnings ?? [])
        .filter(
          (warning) =>
            selectedMachineId === ALL_PARTNER_MACHINES ||
            !warning.machineId ||
            warning.machineId === selectedMachineId
        )
        .filter((warning) => !isReportingTabWarning(warning)),
    [preview?.warnings, selectedMachineId]
  );
  const hasBlockingWarnings = blockingWarnings.length > 0;
  const showPartnerWarnings = canSeeInternalPartnerWarnings
    ? blockingWarnings.length > 0 || nonBlockingWarnings.length > 0
    : hasBlockingWarnings;
  const previewFetching = selectedPreviewFetching || trendPreviewFetching;
  const trendLabel = getPartnerModeLabel(periodMode);
  const inProgressPeriodLabel = selectedPeriod?.isInProgress
    ? `Data through ${formatDate(selectedPeriod.dateTo)}`
    : '';
  const partnerExportDisabled =
    !preview ||
    !currentPeriod ||
    !selectedPeriod ||
    previewLoading ||
    previewFetching ||
    hasBlockingWarnings ||
    Boolean(exportingPartnerFormat);
  const partnerExportButtonLabel =
    exportingPartnerFormat === 'pdf'
      ? 'Preparing PDF'
      : exportingPartnerFormat === 'xlsx'
      ? 'Preparing XLSX'
        : exportingPartnerFormat === 'csv'
          ? 'Preparing CSV'
          : 'Export';
  const showNoPartnerMachines = Boolean(preview && preview.machinePeriods.length === 0);

  const exportPartnerReport = async (format: PartnerDashboardExportFormat) => {
    if (!preview || !currentPeriod) {
      toast.error('Load a partner report period before exporting.');
      return;
    }
    if (previewFetching) {
      toast.error('Wait for the latest partner dashboard numbers before exporting.');
      return;
    }
    if (hasBlockingWarnings) {
      toast.error(
        canSeeInternalPartnerWarnings
          ? 'Resolve blocking admin review items before exporting the partner report.'
          : PARTNER_REPORT_EXPORT_BLOCKED_MESSAGE
      );
      return;
    }

    const exportWindow = reserveSignedExportWindow();
    setExportingPartnerFormat(format);
    try {
      const exportPeriodLabel = currentPeriod
        ? formatPartnerPeriod(currentPeriod, periodMode)
        : selectedPeriod?.label;
      const exportResult = await exportPartnerDashboardReport({
        partnershipId: preview.partnershipId,
        periodGrain: selectedPeriod?.periodGrain ?? preview.periodGrain,
        periodMode,
        periodLabel: getPartnerExportPeriodLabel(selectedPeriod),
        dateFrom: selectedPeriod?.dateFrom ?? currentPeriod.periodStart,
        dateTo: selectedPeriod?.dateTo ?? currentPeriod.periodEnd,
        format,
        machineIds: scopedMachineIds,
      });
      openSignedExportUrl(exportResult.signedUrl, exportWindow);
      const exportFormatLabel =
        format === 'pdf' ? 'PDF' : format === 'xlsx' ? 'Excel workbook' : 'CSV';
      const machineScopeLabel = selectedMachineLabel ? ` for ${selectedMachineLabel}` : '';
      toast.success(
        `${trendLabel} partner ${exportFormatLabel} generated${machineScopeLabel} for ${exportPeriodLabel}.`
      );
    } catch (error) {
      closeReservedSignedExportWindow(exportWindow);
      toast.error(error instanceof Error ? error.message : 'Unable to export partner report.');
    } finally {
      setExportingPartnerFormat(null);
    }
  };

  if (partnershipsLoading) {
    return <PartnerDashboardSkeleton />;
  }

  if (partnershipsError) {
    return (
      <PartnerDashboardUnavailableState
        title={
          canSeeInternalPartnerWarnings
            ? 'Partner Dashboard unavailable'
            : PARTNER_REPORT_UNAVAILABLE_TITLE
        }
        description={
          canSeeInternalPartnerWarnings
            ? 'Bloomjoy could not confirm the partner dashboard scope for this session.'
            : PARTNER_REPORT_UNAVAILABLE_DESCRIPTION
        }
        reasons={
          canSeeInternalPartnerWarnings
            ? [
                isCorporatePartner
                  ? 'Corporate Partner grant: confirm this login still has an active Corporate Partner grant tied to the intended partner record.'
                  : 'Corporate Partner grant: this session does not show a Corporate Partner portal grant.',
                'Portal-enabled partnership: confirm the partnership is active and enabled for portal reporting.',
                'Machines: confirm the partnership has assigned reporting machines.',
                'Session: if access was just granted or updated, sign out and sign back in before retrying.',
              ]
            : PARTNER_REPORT_UNAVAILABLE_REASONS
        }
        tone={canSeeInternalPartnerWarnings ? 'destructive' : 'default'}
      />
    );
  }

  if (partnerships.length === 0) {
    return (
      <PartnerDashboardUnavailableState
        title={
          canSeeInternalPartnerWarnings
            ? 'Partner Dashboard unavailable'
            : PARTNER_REPORT_UNAVAILABLE_TITLE
        }
        description={
          canSeeInternalPartnerWarnings
            ? isCorporatePartner
              ? 'This Corporate Partner login is recognized, but no dashboard-ready partnership is visible yet.'
              : 'No active partner dashboard scope is visible for this role.'
            : PARTNER_REPORT_UNAVAILABLE_DESCRIPTION
        }
        reasons={
          canSeeInternalPartnerWarnings
            ? [
                'Corporate Partner grant: confirm the grant is active and connected to the right partner record.',
                'Portal-enabled partnership: confirm an active partnership is enabled for portal reporting.',
                'Machines: confirm at least one reporting machine is assigned to that partnership.',
                'Session: if Bloomjoy just changed access, sign out and sign back in to refresh the portal session.',
              ]
            : PARTNER_REPORT_UNAVAILABLE_REASONS
        }
        action={
          isSuperAdmin ? (
            <Button asChild>
              <Link to="/admin/partnerships">Open partnership setup</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6 print:hidden">
        <Card>
          <CardContent className="grid gap-4 p-4">
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(220px,1fr)_minmax(300px,0.95fr)_minmax(220px,0.8fr)_minmax(220px,0.85fr)_auto] 2xl:items-end">
              <LabeledControl label="Partnership" htmlFor="partner-dashboard-partnership">
                <Select value={selectedPartnershipId} onValueChange={setSelectedPartnershipId}>
                  <SelectTrigger id="partner-dashboard-partnership">
                    <SelectValue placeholder="Select partnership" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {partnerships.map((partnership) => (
                        <SelectItem key={partnership.id} value={partnership.id}>
                          {partnership.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LabeledControl>

              <div className="flex flex-col gap-2">
                <Label id="partner-dashboard-view-label">View</Label>
                <ToggleGroup
                  aria-labelledby="partner-dashboard-view-label"
                  type="single"
                  value={periodMode}
                  onValueChange={(value) => {
                    if (
                      value === 'weekly' ||
                      value === 'month_to_date' ||
                      value === 'completed_month'
                    ) {
                      setPeriodMode(value);
                    }
                  }}
                  className="grid grid-cols-3 rounded-lg border border-border bg-background p-1"
                >
                  <ToggleGroupItem value="weekly" className="h-auto min-h-9 rounded-md px-3 py-2 text-center text-xs leading-tight">
                    Weekly
                  </ToggleGroupItem>
                  <ToggleGroupItem value="month_to_date" className="h-auto min-h-9 rounded-md px-3 py-2 text-center text-xs leading-tight">
                    Month to date
                  </ToggleGroupItem>
                  <ToggleGroupItem value="completed_month" className="h-auto min-h-9 rounded-md px-3 py-2 text-center text-xs leading-tight">
                    Completed month
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <LabeledControl
                label={getPartnerPeriodSelectLabel(periodMode)}
                htmlFor="partner-dashboard-period"
              >
                <Select
                  value={selectedPeriod?.key ?? ''}
                  onValueChange={setSelectedPeriodKey}
                  disabled={periodOptions.length === 0}
                >
                  <SelectTrigger id="partner-dashboard-period">
                    <SelectValue placeholder={getPartnerPeriodPlaceholder(periodMode)} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {periodOptions.map((period) => (
                        <SelectItem key={period.key} value={period.key}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LabeledControl>

              <LabeledControl label="Machine" htmlFor="partner-dashboard-machine">
                <PartnerMachineSelector
                  id="partner-dashboard-machine"
                  triggerRef={machinePickerRef}
                  options={machineOptions}
                  value={selectedMachineId}
                  onValueChange={selectMachineScope}
                  disabled={machineOptions.length === 0}
                />
              </LabeledControl>

              <div className="flex flex-col gap-2 sm:flex-row lg:col-span-2 lg:justify-end 2xl:col-span-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      disabled={partnerExportDisabled}
                      className="w-full justify-center sm:w-auto"
                      data-portal-report-export="partner"
                    >
                      {exportingPartnerFormat ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {partnerExportButtonLabel}
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuItem
                      className="items-start gap-3"
                      onSelect={() => void exportPartnerReport('pdf')}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium">Polished PDF report</span>
                        <span className="block text-xs text-muted-foreground">
                          Partner-ready revenue share report.
                        </span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="items-start gap-3"
                      onSelect={() => void exportPartnerReport('xlsx')}
                    >
                      <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium">Detailed Excel workbook (.xlsx)</span>
                        <span className="block text-xs text-muted-foreground">
                          Summary, rollups, assumptions, warnings, and reconciliation checks.
                        </span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="items-start gap-3"
                      onSelect={() => void exportPartnerReport('csv')}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium">CSV reconciliation (.csv)</span>
                        <span className="block text-xs text-muted-foreground">
                          Existing approved reporting detail.
                        </span>
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {selectedPeriod?.isInProgress && (
              <div
                aria-live="polite"
                className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground sm:flex sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="font-medium text-foreground">
                  Month-to-date reporting
                  <Badge variant="secondary" className="ml-2 align-middle">
                    In progress
                  </Badge>
                </span>
                <span className="block sm:text-right">
                  {selectedMachineLabel ? `${selectedMachineLabel} - ` : ''}
                  {inProgressPeriodLabel}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedMachine && selectedPartnership && (
          <PartnerMachineScopeBar
            scopeRef={machineScopeRef}
            partnershipName={selectedPartnership.name}
            machine={selectedMachine}
            onBack={clearMachineScope}
          />
        )}

      {previewError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {canSeeInternalPartnerWarnings
              ? 'Unable to load partner preview'
              : PARTNER_REPORT_UNAVAILABLE_TITLE}
          </AlertTitle>
          <AlertDescription>
            {canSeeInternalPartnerWarnings ? (
              <>
                {previewError instanceof Error
                  ? previewError.message
                  : 'Check the partnership setup and try again.'}{' '}
                Confirm the Corporate Partner grant, portal-enabled partnership, assigned machines,
                and sign out and back in if access changed recently.
              </>
            ) : (
              PARTNER_REPORT_UNAVAILABLE_DESCRIPTION
            )}
          </AlertDescription>
        </Alert>
      )}

      {trendPreviewError && !previewError && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Comparison trend unavailable</AlertTitle>
          <AlertDescription>
            The selected period values are loaded, but the prior-period comparison could not refresh.
          </AlertDescription>
        </Alert>
      )}

      {previewLoading ? (
        <PartnerDashboardSkeleton />
      ) : preview ? (
        <>
          {showNoPartnerMachines && (
            <PartnerDashboardUnavailableState
              title={
                canSeeInternalPartnerWarnings
                  ? 'No partner machines visible'
                  : PARTNER_REPORT_UNAVAILABLE_TITLE
              }
              description={
                canSeeInternalPartnerWarnings
                  ? 'The Partner Dashboard opened, but this partnership has no machines visible for the selected reporting period.'
                  : PARTNER_REPORT_UNAVAILABLE_DESCRIPTION
              }
              reasons={
                canSeeInternalPartnerWarnings
                  ? [
                      'Machines: confirm at least one reporting machine is assigned to this partnership.',
                      'Period: if the partnership has machines but this period has no sales, try another reporting period before escalating.',
                      'Portal-enabled partnership: confirm the partnership is active and enabled for portal reporting.',
                      'Session: if machine access was just changed, sign out and sign back in before retrying.',
                    ]
                  : PARTNER_REPORT_UNAVAILABLE_REASONS
              }
            />
          )}

          <PartnerAnswerBand
            preview={preview}
            currentPeriod={currentPeriod}
            previousPeriod={previousPeriod}
            trendLabel={trendLabel}
            periodMode={periodMode}
            selectedMachineLabel={selectedMachineLabel}
            isInProgressPeriod={Boolean(selectedPeriod?.isInProgress)}
          />

          {showPartnerWarnings && (
            <Alert className="border-amber/20 bg-amber/10 text-foreground">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {canSeeInternalPartnerWarnings
                  ? blockingWarnings.length > 0
                    ? 'Report setup needs attention'
                    : 'Report notes'
                  : PARTNER_REPORT_DATA_INCOMPLETE_TITLE}
              </AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex flex-col gap-2">
                  {canSeeInternalPartnerWarnings ? (
                    <>
                      {blockingWarnings.length > 0 && (
                        <div className="font-medium">
                          Partner export is locked until blocking setup items are resolved in admin.
                        </div>
                      )}
                      {blockingWarnings.slice(0, 4).map((warning, index) => (
                        <div key={`${warning.warningType}-${warning.machineId ?? 'scope'}-${index}`}>
                          <Badge variant="destructive">Blocking</Badge>{' '}
                          {warning.message}
                        </div>
                      ))}
                      {blockingWarnings.length > 4 && (
                        <div>{blockingWarnings.length - 4} more blocking warnings hidden.</div>
                      )}
                      {nonBlockingWarnings.slice(0, blockingWarnings.length > 0 ? 2 : 4).map((warning, index) => (
                        <div key={`${warning.warningType}-${warning.machineId ?? 'scope'}-note-${index}`}>
                          <Badge variant="secondary">Note</Badge>{' '}
                          {warning.message}
                        </div>
                      ))}
                      {nonBlockingWarnings.length > (blockingWarnings.length > 0 ? 2 : 4) && (
                        <div>
                          {nonBlockingWarnings.length - (blockingWarnings.length > 0 ? 2 : 4)} more notes hidden.
                        </div>
                      )}
                      {blockingWarnings.length > 0 && isSuperAdmin && (
                        <Button asChild variant="outline" size="sm" className="w-fit">
                          <Link to="/admin/partnerships">Open admin setup</Link>
                        </Button>
                      )}
                    </>
                  ) : (
                    <div className="font-medium">{PARTNER_REPORT_EXPORT_BLOCKED_MESSAGE}</div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid min-w-0 gap-6">
            <PartnerTrendCard
              title="Net sales trend"
              description={`${trendLabel} net sales for ${selectedMachineLabel ?? 'all selected partnership machines'}.`}
              data={netSalesTrendData}
              config={partnerNetSalesChartConfig}
              dataKey="netSales"
              value={formatCurrency(currentPeriod?.netSalesCents ?? 0, true)}
              change={formatPercentChange(
                currentPeriod?.netSalesCents ?? 0,
                previousPeriod?.netSalesCents ?? 0
              )}
              current={currentPeriod?.netSalesCents ?? 0}
              previous={previousPeriod?.netSalesCents ?? 0}
              valueFormatter={(value) => formatCurrency(Math.round(value * 100))}
            />
          </div>

          <div className="grid min-w-0 gap-6">
            {selectedMachineId === ALL_PARTNER_MACHINES ? (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-xl">Machine rollups</CardTitle>
                  <CardDescription>
                    All assigned machines for the selected {getPartnerPeriodNoun(periodMode)}, compared with the previous period.
                    {selectedMachineLabel ? ` ${selectedMachineLabel} is highlighted.` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {machineRows.length === 0 ? (
                    <EmptyPanel title="No machine rollups" description="Assign machines and import sales before this table can show partner performance." />
                  ) : (
                    <>
                      <div className="flex flex-col gap-3 md:hidden">
                        {machineRows.map((row) => (
                          <PartnerMachineMobileCard
                            key={row.current.reportingMachineId}
                            row={row}
                            machine={machineOptionsById.get(row.current.reportingMachineId)}
                            isSelected={row.current.reportingMachineId === selectedMachineId}
                            onViewMachine={() =>
                              selectMachineScope(row.current.reportingMachineId)
                            }
                          />
                        ))}
                      </div>
                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Machine</TableHead>
                              <TableHead className="text-right">Gross sales</TableHead>
                              <TableHead className="text-right">Refunds</TableHead>
                              <TableHead className="text-right">Volume</TableHead>
                              <TableHead className="text-right">Tax + deductions</TableHead>
                              <TableHead className="text-right">Net sales</TableHead>
                              {showPayoutBasisColumn && (
                                <TableHead className="text-right">Payout basis</TableHead>
                              )}
                              <TableHead className="text-right">{PARTNER_REVENUE_SHARE_LABEL}</TableHead>
                              <TableHead className="text-right">Change</TableHead>
                              <TableHead className="text-right">
                                <span className="sr-only">Machine details</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {machineRows.map((row) => {
                              const TrendIcon = getTrendIcon(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0);
                              const machineOption = machineOptionsById.get(
                                row.current.reportingMachineId
                              );
                              return (
                                <TableRow
                                  key={row.current.reportingMachineId}
                                  data-reporting-partner-machine-row="desktop"
                                  data-machine-id={row.current.reportingMachineId}
                                  className={cn(
                                    row.current.reportingMachineId === selectedMachineId && 'bg-muted/40'
                                  )}
                                >
                                  <TableCell>
                                    <div className="font-medium">
                                      {machineOption?.displayLabel ?? row.current.machineLabel}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      <span>{row.current.locationName ?? 'Location not provided'}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(row.current.grossSalesCents, true)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    -{formatCurrency(row.current.refundAmountCents, true)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div>{numberFormatter.format(periodVolume(row.current))} items</div>
                                    <div className="text-xs text-muted-foreground">
                                      {numberFormatter.format(row.current.orderCount)} transactions
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div>{formatCurrency(row.current.taxCents + row.current.feeCents, true)}</div>
                                    {hasAdditionalCosts(row.current) && (
                                      <div className="text-xs text-muted-foreground">
                                        Additional costs {formatCurrency(row.current.costCents, true)}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div>{formatCurrency(row.current.netSalesCents, true)}</div>
                                    {!showPayoutBasisColumn && usesNetSalesAsPayoutBasis(row.current) && (
                                      <div className="text-xs text-muted-foreground">Payout basis</div>
                                    )}
                                  </TableCell>
                                  {showPayoutBasisColumn && (
                                    <TableCell className="text-right">
                                      {formatCurrency(row.current.splitBaseCents, true)}
                                    </TableCell>
                                  )}
                                  <TableCell className="text-right">
                                    {formatCurrency(row.current.amountOwedCents, true)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div
                                      className={cn(
                                        'inline-flex items-center justify-end gap-1 font-medium',
                                        getChangeTone(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0)
                                      )}
                                    >
                                      <TrendIcon className="h-4 w-4" />
                                      {formatPercentChange(
                                        row.current.grossSalesCents,
                                        row.previous?.grossSalesCents ?? 0
                                      )}
                                    </div>
                                    <div
                                      className={cn(
                                        'text-xs',
                                        getChangeTone(periodVolume(row.current), periodVolume(row.previous))
                                      )}
                                    >
                                      Volume {formatPercentChange(periodVolume(row.current), periodVolume(row.previous))}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="min-h-9 whitespace-nowrap"
                                      onClick={() =>
                                        selectMachineScope(row.current.reportingMachineId)
                                      }
                                      data-reporting-partner-machine-action
                                      data-machine-id={row.current.reportingMachineId}
                                      aria-label={`View details for ${machineOption?.displayLabel ?? row.current.machineLabel}`}
                                    >
                                      <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                                      View machine
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <PartnerMachineHistoryCard
                rows={machineHistoryRows}
                periodMode={periodMode}
                machineLabel={selectedMachineLabel}
                showPayoutBasisColumn={showHistoryPayoutBasisColumn}
              />
            )}

            <PartnerCalculationCard
              summary={currentPeriod ?? preview.summary}
              periodLabel={
                currentPeriod
                  ? formatPartnerPeriod(currentPeriod, periodMode)
                  : `${formatDate(preview.dateFrom)} - ${formatDate(preview.dateTo)}`
              }
              selectedMachineLabel={selectedMachineLabel}
            />
          </div>
        </>
      ) : (
        <EmptyPanel title="Select a partnership" description="Choose an active partnership to load the partner dashboard preview." />
      )}
      </div>
      {preview && !hasBlockingWarnings && (
        <Suspense fallback={null}>
          <PartnerPrintableReport
            preview={preview}
            periods={displayPeriods}
            machineRows={machineRows}
            currentPeriod={currentPeriod}
            previousPeriod={previousPeriod}
            periodMode={periodMode}
            selectedMachineLabel={selectedMachineLabel}
            isInProgressPeriod={Boolean(selectedPeriod?.isInProgress)}
          />
        </Suspense>
      )}
    </>
  );
}

function PartnerAnswerBand({
  preview,
  currentPeriod,
  previousPeriod,
  trendLabel,
  periodMode,
  selectedMachineLabel,
  isInProgressPeriod,
}: {
  preview: PartnerDashboardPeriodPreview;
  currentPeriod: PartnerDashboardPeriod | undefined;
  previousPeriod: PartnerDashboardPeriod | undefined;
  trendLabel: string;
  periodMode: PartnerPeriodMode;
  selectedMachineLabel?: string;
  isInProgressPeriod: boolean;
}) {
  const current = currentPeriod ?? preview.summary;
  const previous = previousPeriod;
  const periodNoun = getPartnerComparisonNoun(periodMode);
  const scopeLabel = selectedMachineLabel ?? 'All machines';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">Partner performance summary</CardTitle>
        <CardDescription>
          {preview.partnershipName} - {scopeLabel} - {trendLabel} view
          {isInProgressPeriod ? ' - in progress' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 p-5 pt-0 md:grid-cols-2 xl:grid-cols-5">
        <AnswerItem
          label={PARTNER_REVENUE_SHARE_LABEL}
          value={formatCurrency(current.amountOwedCents, true)}
          detail={`${formatPercentChange(current.amountOwedCents, previous?.amountOwedCents ?? 0)} vs previous ${periodNoun}`}
          emphasis
        />
        <AnswerItem
          label="Gross sales"
          value={formatCurrency(current.grossSalesCents, true)}
          detail={`${formatPercentChange(current.grossSalesCents, previous?.grossSalesCents ?? 0)} vs previous ${periodNoun}`}
        />
        <AnswerItem
          label="Refund impact"
          value={`-${formatCurrency(current.refundAmountCents, true)}`}
          detail="Applied approved adjustments"
        />
        <AnswerItem
          label="Net sales"
          value={formatCurrency(current.netSalesCents, true)}
          detail="After tax, refunds, and configured deductions"
        />
        <AnswerItem
          label="Split base"
          value={formatCurrency(current.splitBaseCents, true)}
          detail={`${numberFormatter.format(current.orderCount)} transactions`}
        />
      </CardContent>
    </Card>
  );
}

function PartnerTrendCard({
  title,
  description,
  data,
  config,
  dataKey,
  value,
  change,
  current,
  previous,
  valueFormatter,
}: {
  title: string;
  description: string;
  data: Array<Record<string, string | number>>;
  config: ChartConfig;
  dataKey: string;
  value: string;
  change: string;
  current: number;
  previous: number;
  valueFormatter?: (value: number) => string;
}) {
  const TrendIcon = getTrendIcon(current, previous);
  const hasVisibleValues = data.some((point) => Number(point[dataKey] ?? 0) > 0);

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-2xl font-semibold text-foreground">{value}</div>
            <div className={cn('mt-1 inline-flex items-center gap-1 text-sm', getChangeTone(current, previous))}>
              <TrendIcon className="h-4 w-4" />
              {change}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 || !hasVisibleValues ? (
          <EmptyPanel title="No trend data" description="This period has no imported partner sales yet." />
        ) : (
          <>
            <ChartContainer
              config={config}
              className="!aspect-auto h-[260px] w-full max-w-full sm:h-[320px]"
            >
              <BarChart data={data} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="period" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(tick) =>
                    valueFormatter ? valueFormatter(Number(tick)) : numberFormatter.format(Number(tick))
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(tooltipValue) =>
                        valueFormatter
                          ? valueFormatter(Number(tooltipValue))
                          : numberFormatter.format(Number(tooltipValue))
                      }
                    />
                  }
                />
                <Bar
                  dataKey={dataKey}
                  fill={`var(--color-${dataKey})`}
                  radius={[5, 5, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
            <div className="mt-4 grid gap-2 md:hidden">
              {data.map((point) => {
                const rawValue = Number(point[dataKey] ?? 0);
                return (
                  <div
                    key={`${point.period}-${rawValue}`}
                    className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 text-muted-foreground">{point.period}</span>
                    <span className="shrink-0 font-medium text-foreground">
                      {valueFormatter ? valueFormatter(rawValue) : numberFormatter.format(rawValue)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PartnerMachineHistoryCard({
  rows,
  periodMode,
  machineLabel,
  showPayoutBasisColumn,
}: {
  rows: PartnerMachineHistoryRow[];
  periodMode: PartnerPeriodMode;
  machineLabel?: string;
  showPayoutBasisColumn: boolean;
}) {
  return (
    <Card className="min-w-0" data-reporting-partner-machine-history>
      <CardHeader>
        <CardTitle className="text-xl">Machine history</CardTitle>
        <CardDescription>
          {machineLabel ?? 'Selected machine'} history across {getPartnerModeLabel(periodMode).toLowerCase()} periods.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyPanel
            title="No machine history"
            description="Import sales for this machine before history can be shown."
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 md:hidden">
              {rows.map((row) => (
                <PartnerMachineHistoryMobileCard
                  key={`${row.period.periodStart}-${row.period.periodEnd}`}
                  row={row}
                  periodMode={periodMode}
                  showPayoutBasisColumn={showPayoutBasisColumn}
                />
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Gross sales</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Tax + deductions</TableHead>
                    <TableHead className="text-right">Net sales</TableHead>
                    {showPayoutBasisColumn && (
                      <TableHead className="text-right">Payout basis</TableHead>
                    )}
                    <TableHead className="text-right">{PARTNER_REVENUE_SHARE_LABEL}</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const TrendIcon = row.previous
                      ? getTrendIcon(row.period.grossSalesCents, row.previous.grossSalesCents)
                      : Info;

                    return (
                      <TableRow
                        key={`${row.period.periodStart}-${row.period.periodEnd}`}
                        className={cn(row.isCurrent && 'bg-muted/40')}
                      >
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {formatPartnerPeriod(row.period, periodMode)}
                            </span>
                            {row.isCurrent && <Badge variant="secondary">Current</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.period.grossSalesCents, true)}
                        </TableCell>
                        <TableCell className="text-right">
                          -{formatCurrency(row.period.refundAmountCents, true)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div>{numberFormatter.format(periodVolume(row.period))} items</div>
                          <div className="text-xs text-muted-foreground">
                            {numberFormatter.format(row.period.orderCount)} transactions
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div>{formatCurrency(row.period.taxCents + row.period.feeCents, true)}</div>
                          {hasAdditionalCosts(row.period) && (
                            <div className="text-xs text-muted-foreground">
                              Additional costs {formatCurrency(row.period.costCents, true)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div>{formatCurrency(row.period.netSalesCents, true)}</div>
                          {!showPayoutBasisColumn && usesNetSalesAsPayoutBasis(row.period) && (
                            <div className="text-xs text-muted-foreground">Payout basis</div>
                          )}
                        </TableCell>
                        {showPayoutBasisColumn && (
                          <TableCell className="text-right">
                            {formatCurrency(row.period.splitBaseCents, true)}
                          </TableCell>
                        )}
                        <TableCell className="text-right font-medium text-foreground">
                          {formatCurrency(row.period.amountOwedCents, true)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.previous ? (
                            <>
                              <div
                                className={cn(
                                  'inline-flex items-center justify-end gap-1 font-medium',
                                  getChangeTone(
                                    row.period.grossSalesCents,
                                    row.previous.grossSalesCents
                                  )
                                )}
                              >
                                <TrendIcon className="h-4 w-4" />
                                {formatPercentChange(
                                  row.period.grossSalesCents,
                                  row.previous.grossSalesCents
                                )}
                              </div>
                              <div
                                className={cn(
                                  'text-xs',
                                  getChangeTone(periodVolume(row.period), periodVolume(row.previous))
                                )}
                              >
                                Volume {formatPercentChange(periodVolume(row.period), periodVolume(row.previous))}
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-muted-foreground">No prior history</div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PartnerMachineHistoryMobileCard({
  row,
  periodMode,
  showPayoutBasisColumn,
}: {
  row: PartnerMachineHistoryRow;
  periodMode: PartnerPeriodMode;
  showPayoutBasisColumn: boolean;
}) {
  const TrendIcon = row.previous
    ? getTrendIcon(row.period.grossSalesCents, row.previous.grossSalesCents)
    : Info;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-background p-4',
        row.isCurrent && 'bg-muted/40'
      )}
    >
      <div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            <span>{formatPartnerPeriod(row.period, periodMode)}</span>
            {row.isCurrent && <Badge variant="secondary">Current</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-left min-[390px]:text-right">
          <div className="font-semibold text-foreground">
            {formatCurrency(row.period.grossSalesCents, true)}
          </div>
          {row.previous ? (
            <div
              className={cn(
                'mt-1 inline-flex items-center gap-1 text-xs font-medium',
                getChangeTone(row.period.grossSalesCents, row.previous.grossSalesCents)
              )}
            >
              <TrendIcon className="h-3.5 w-3.5" />
              {formatPercentChange(row.period.grossSalesCents, row.previous.grossSalesCents)}
            </div>
          ) : (
            <div className="mt-1 text-xs text-muted-foreground">No prior history</div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 text-sm min-[390px]:grid-cols-2">
        <MobileProofItem
          label="Volume"
          value={`${numberFormatter.format(periodVolume(row.period))} items`}
          detail={`${numberFormatter.format(row.period.orderCount)} transactions`}
        />
        <MobileProofItem
          label={PARTNER_REVENUE_SHARE_LABEL}
          value={formatCurrency(row.period.amountOwedCents, true)}
          detail={
            row.previous
              ? `Volume ${formatPercentChange(periodVolume(row.period), periodVolume(row.previous))}`
              : 'No prior history'
          }
        />
        <MobileProofItem
          label="Refunds"
          value={`-${formatCurrency(row.period.refundAmountCents, true)}`}
          detail={`Gross sales ${formatCurrency(row.period.grossSalesCents, true)}`}
        />
        <MobileProofItem
          label="Tax + deductions"
          value={formatCurrency(row.period.taxCents + row.period.feeCents, true)}
          detail={formatTaxDeductionsDetail(row.period)}
        />
        <MobileProofItem
          label="Net sales"
          value={formatCurrency(row.period.netSalesCents, true)}
          detail={formatPayoutBasisDetail(row.period)}
        />
        {showPayoutBasisColumn && (
          <MobileProofItem
            label="Payout basis"
            value={formatCurrency(row.period.splitBaseCents, true)}
            detail="Revenue share basis"
          />
        )}
      </div>
    </div>
  );
}

function PartnerMachineMobileCard({
  row,
  machine,
  isSelected = false,
  onViewMachine,
}: {
  row: PartnerMachineComparisonRow;
  machine?: PartnerMachineOption;
  isSelected?: boolean;
  onViewMachine: () => void;
}) {
  const TrendIcon = getTrendIcon(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0);

  return (
    <div
      data-reporting-partner-machine-row="mobile"
      data-machine-id={row.current.reportingMachineId}
      className={cn(
        'rounded-lg border border-border bg-background p-4',
        isSelected && 'bg-muted/40'
      )}
    >
      <div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between">
        <div className="min-w-0">
          <div className="font-medium text-foreground">
            {machine?.displayLabel ?? row.current.machineLabel}
          </div>
          <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{row.current.locationName ?? 'Location not provided'}</span>
          </div>
        </div>
        <div className="shrink-0 text-left min-[390px]:text-right">
          <div className="font-semibold text-foreground">
            {formatCurrency(row.current.grossSalesCents, true)}
          </div>
          <div
            className={cn(
              'mt-1 inline-flex items-center gap-1 text-xs font-medium',
              getChangeTone(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0)
            )}
          >
            <TrendIcon className="h-3.5 w-3.5" />
            {formatPercentChange(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 text-sm min-[390px]:grid-cols-2">
        <MobileProofItem
          label="Volume"
          value={`${numberFormatter.format(periodVolume(row.current))} items`}
          detail={`${numberFormatter.format(row.current.orderCount)} transactions`}
        />
        <MobileProofItem
          label={PARTNER_REVENUE_SHARE_LABEL}
          value={formatCurrency(row.current.amountOwedCents, true)}
          detail={`Volume ${formatPercentChange(periodVolume(row.current), periodVolume(row.previous))}`}
        />
        <MobileProofItem
          label="Net sales"
          value={formatCurrency(row.current.netSalesCents, true)}
          detail={`Refunds -${formatCurrency(row.current.refundAmountCents, true)} / ${formatPayoutBasisDetail(row.current)}`}
        />
        <MobileProofItem
          label="Tax + deductions"
          value={formatCurrency(row.current.taxCents + row.current.feeCents, true)}
          detail={formatTaxDeductionsDetail(row.current)}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        className="mt-4 min-h-11 w-full"
        onClick={onViewMachine}
        data-reporting-partner-machine-action
        data-machine-id={row.current.reportingMachineId}
        aria-label={`View details for ${machine?.displayLabel ?? row.current.machineLabel}`}
      >
        <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
        View machine details
      </Button>
    </div>
  );
}

function MobileProofItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md bg-muted/30 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words font-medium text-foreground">{value}</div>
      <div className="mt-1 break-words text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function PartnerCalculationCard({
  summary,
  periodLabel,
  selectedMachineLabel,
}: {
  summary: PartnerDashboardTotals;
  periodLabel: string;
  selectedMachineLabel?: string;
}) {
  const summaryHasAdditionalCosts = hasAdditionalCosts(summary);
  const summaryUsesNetSalesAsPayoutBasis = usesNetSalesAsPayoutBasis(summary);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-xl">Calculation</CardTitle>
        <CardDescription>
          {selectedMachineLabel ? `${selectedMachineLabel} - ` : ''}
          {periodLabel} revenue share calculation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CalculationLine label="Gross sales" value={formatCurrency(summary.grossSalesCents, true)} />
        <CalculationLine label="Refund impact" value={`-${formatCurrency(summary.refundAmountCents, true)}`} />
        <CalculationLine label="Tax impact" value={`-${formatCurrency(summary.taxCents, true)}`} />
        <CalculationLine label="Configured deductions" value={`-${formatCurrency(summary.feeCents, true)}`} />
        {summaryHasAdditionalCosts && (
          <CalculationLine label="Additional costs" value={`-${formatCurrency(summary.costCents, true)}`} />
        )}
        <CalculationLine label="Net sales" value={formatCurrency(summary.netSalesCents, true)} />
        {!summaryUsesNetSalesAsPayoutBasis && (
          <CalculationLine label="Payout basis" value={formatCurrency(summary.splitBaseCents, true)} />
        )}
        <CalculationLine
          label={PARTNER_REVENUE_SHARE_LABEL}
          value={formatCurrency(summary.amountOwedCents, true)}
          emphasis
        />
        <CalculationLine
          label="Bloomjoy retained"
          value={formatCurrency(summary.bloomjoyRetainedCents, true)}
        />
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">How this is calculated</div>
          <p className="mt-2">
            Gross sales uses the imported order amount for partner reporting. Machine tax,
            approved refund adjustments, and configured deductions are deducted once to create net
            sales.
            {summaryUsesNetSalesAsPayoutBasis
              ? ' Net sales is the payout basis for this period.'
              : ' The active rule then adjusts net sales into the payout basis.'}
            {' '}The configured share is applied to the payout basis to calculate Partner Revenue Share.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function buildPartnerMachineRows(
  preview: PartnerDashboardPeriodPreview | undefined,
  currentPeriod: PartnerDashboardPeriod | undefined,
  previousPeriod: PartnerDashboardPeriod | undefined,
  comparisonPreview?: PartnerDashboardPeriodPreview
): PartnerMachineComparisonRow[] {
  if (!preview || !currentPeriod) return [];

  const previousByMachine = new Map<string, PartnerDashboardMachinePeriod>();
  if (previousPeriod) {
    (comparisonPreview ?? preview).machinePeriods
      .filter((machine) => machine.periodStart === previousPeriod.periodStart)
      .forEach((machine) => previousByMachine.set(machine.reportingMachineId, machine));
  }

  return preview.machinePeriods
    .filter((machine) => machine.periodStart === currentPeriod.periodStart)
    .map((current) => ({
      current,
      previous: previousByMachine.get(current.reportingMachineId),
    }))
    .sort((left, right) => right.current.grossSalesCents - left.current.grossSalesCents);
}

function PartnerMachineSelector({
  id,
  triggerRef,
  options,
  value,
  onValueChange,
  disabled,
}: {
  id: string;
  triggerRef: Ref<HTMLButtonElement>;
  options: PartnerMachineOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedMachine = options.find((machine) => machine.id === value);
  const selectedLabel = selectedMachine?.displayLabel ?? 'All machines';

  if (options.length < PARTNER_MACHINE_SEARCH_THRESHOLD) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          ref={triggerRef}
          id={id}
          data-reporting-partner-machine-picker
        >
          <SelectValue placeholder="All machines" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_PARTNER_MACHINES}>All machines</SelectItem>
            {options.map((machine) => (
              <SelectItem key={machine.id} value={machine.id}>
                {machine.displayLabel}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Machine scope: ${selectedLabel}`}
          disabled={disabled}
          data-reporting-partner-machine-picker
          className="min-h-10 w-full justify-between gap-2 px-3 font-normal"
        >
          <span className="truncate text-left">{selectedLabel}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0"
      >
        <Command>
          <CommandInput placeholder="Search machine or location..." />
          <CommandList>
            <CommandEmpty>No machine found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="All machines"
                onSelect={() => {
                  onValueChange(ALL_PARTNER_MACHINES);
                  setOpen(false);
                }}
                className="min-h-11"
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 shrink-0',
                    value === ALL_PARTNER_MACHINES ? 'opacity-100' : 'opacity-0'
                  )}
                  aria-hidden="true"
                />
                All machines
              </CommandItem>
              {options.map((machine) => (
                <CommandItem
                  key={machine.id}
                  value={`${machine.displayLabel} ${machine.locationName ?? ''}`}
                  onSelect={() => {
                    onValueChange(machine.id);
                    setOpen(false);
                  }}
                  className="min-h-11 items-start"
                >
                  <Check
                    className={cn(
                      'mr-2 mt-0.5 h-4 w-4 shrink-0',
                      value === machine.id ? 'opacity-100' : 'opacity-0'
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{machine.displayLabel}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {machine.locationName ?? 'Location not provided'}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PartnerMachineScopeBar({
  scopeRef,
  partnershipName,
  machine,
  onBack,
}: {
  scopeRef: Ref<HTMLElement>;
  partnershipName: string;
  machine: PartnerMachineOption;
  onBack: () => void;
}) {
  return (
    <section
      ref={scopeRef}
      tabIndex={-1}
      aria-label="Current machine scope"
      aria-live="polite"
      data-reporting-partner-machine-scope
      className="sticky top-[4.75rem] z-30 flex scroll-mt-[5.5rem] flex-col gap-3 rounded-xl border border-primary/20 bg-background/95 p-3 shadow-sm outline-none backdrop-blur focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 supports-[backdrop-filter]:bg-background/90 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between lg:top-3 lg:scroll-mt-4"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate text-muted-foreground">{partnershipName}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{machine.displayLabel}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{machine.locationName ?? 'Location not provided'}</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 shrink-0 min-[390px]:min-h-9"
        onClick={onBack}
        data-reporting-partner-back-all
      >
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        Back to all machines
      </Button>
    </section>
  );
}

function LabeledControl({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  context,
}: {
  label: string;
  value: string;
  context: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 break-words text-2xl font-semibold text-foreground">{value}</div>
        <div className="mt-2 break-words text-sm text-muted-foreground">{context}</div>
      </CardContent>
    </Card>
  );
}

function MetricSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-40" />
      </CardContent>
    </Card>
  );
}

function PartnerDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <MetricSkeletonContent />
          <MetricSkeletonContent />
          <MetricSkeletonContent />
          <MetricSkeletonContent />
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <ChartSkeleton />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <ChartSkeleton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricSkeletonContent() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-4 w-44" />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-[280px] flex-col justify-end gap-3">
      <Skeleton className="h-full w-full" />
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-2 max-w-md text-sm text-muted-foreground">{description}</div>
    </div>
  );
}

function MachineSummaryRow({
  label,
  context,
  primary,
  secondary,
}: {
  label: string;
  context: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="break-words font-medium text-foreground">{label}</div>
          <div className="mt-1 text-sm text-muted-foreground">{context}</div>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <div className="font-semibold text-foreground">{primary}</div>
          <div className="mt-1 text-sm text-muted-foreground">{secondary}</div>
        </div>
      </div>
    </div>
  );
}

function OperatorDailySalesMobileCard({ row }: { row: OperatorDailySalesRow }) {
  const { t } = useLanguage();
  const isZeroSales = isOperatorDailyRowZero(row);

  return (
    <div
      className="rounded-lg border border-border bg-background p-4"
      aria-label={`${t('reports.dailySales')}: ${row.label}`}
      data-reporting-daily-row
      data-date={row.key}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="font-medium text-foreground">{row.label}</div>
        <Badge variant="outline" className="max-w-full whitespace-normal text-left font-normal leading-snug">
          {isZeroSales ? t('reports.noSalesLoaded') : t('reports.salesRecorded')}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 text-sm min-[390px]:grid-cols-2">
        <MobileProofItem
          label={t('reports.netSales')}
          value={formatCurrency(row.netSalesCents, true)}
          detail={t('reports.afterRefundAdjustments')}
        />
        <MobileProofItem
          label={t('reports.grossSales')}
          value={formatCurrency(row.grossSalesCents, true)}
          detail={t('reports.beforeRefundAdjustments')}
        />
        <MobileProofItem
          label={t('reports.refundImpact')}
          value={formatCurrency(row.refundAmountCents, true)}
          detail={t('reports.appliedToDate')}
        />
        <MobileProofItem
          label={t('reports.transactions')}
          value={numberFormatter.format(row.transactionCount)}
          detail={t('reports.ordersCounted')}
        />
      </div>
    </div>
  );
}

function OperatorReportRowMobileCard({ row }: { row: SalesReportRow }) {
  const { t } = useLanguage();

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{formatDate(row.periodStart)}</div>
          <div className="mt-1 break-words text-sm text-muted-foreground">
            {row.machineLabel}
          </div>
        </div>
        <Badge variant="secondary" className="w-fit shrink-0">
          {t(paymentMethodLabelKeys[row.paymentMethod])}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 text-sm min-[390px]:grid-cols-2">
        <MobileProofItem
          label={t('reports.netSales')}
          value={formatCurrency(row.netSalesCents, true)}
          detail={`${numberFormatter.format(row.transactionCount)} ${t('reports.transactions').toLowerCase()}`}
        />
        <MobileProofItem
          label={t('reports.grossSales')}
          value={formatCurrency(row.grossSalesCents, true)}
          detail={`${t('reports.refundImpact')} ${formatCurrency(row.refundAmountCents, true)}`}
        />
      </div>
    </div>
  );
}

function AnswerItem({
  label,
  value,
  detail,
  icon,
  emphasis = false,
  badgeTone,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: ReactNode;
  emphasis?: boolean;
  badgeTone?: 'default' | 'destructive';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-border md:border-r md:pr-5 md:last:border-r-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      {badgeTone ? (
        <div>
          <Badge variant={badgeTone}>{value}</Badge>
        </div>
      ) : (
        <div className={cn('break-words text-2xl font-semibold text-foreground', emphasis && 'text-sage')}>
          {value}
        </div>
      )}
      <div className="break-words text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function CalculationLine({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div className={cn('min-w-0 text-muted-foreground', emphasis && 'font-medium text-foreground')}>
        {label}
      </div>
      <div className={cn('shrink-0 text-right font-medium text-foreground', emphasis && 'text-lg text-sage')}>
        {value}
      </div>
    </div>
  );
}
