import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useAuth } from '@/contexts/AuthContext';
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
  type PartnerDashboardPartnershipOption,
  type PartnerDashboardPeriod,
  type PartnerDashboardPeriodGrain,
  type PartnerDashboardPeriodPreview,
  type PartnerDashboardWarning,
  type PartnerDashboardTotals,
} from '@/lib/partnerDashboardReporting';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type ReportingView = 'operator' | 'partner';
type OperatorPeriodPreset = 'this_week' | 'last_week' | 'last_30_days' | 'month_to_date' | 'custom';
type PartnerPeriodMode = 'weekly' | 'monthly';
type PartnerPeriodOption = {
  key: string;
  mode: PartnerPeriodMode;
  label: string;
  dateFrom: string;
  dateTo: string;
  periodGrain: PartnerDashboardPeriodGrain;
};
type PartnerMachineComparisonRow = {
  current: PartnerDashboardMachinePeriod;
  previous?: PartnerDashboardMachinePeriod;
};

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
  periodGrain: PartnerDashboardPeriodGrain,
  dateFrom: string,
  dateTo: string
) => `${periodGrain}:${dateFrom}:${dateTo}`;

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
        key: getPartnerPeriodKey(periodGrain, dateFrom, dateTo),
        mode,
        label: formatPartnerPeriod({ periodStart: dateFrom, periodEnd: dateTo }, mode),
        dateFrom,
        dateTo,
        periodGrain,
      };
    });
  }

  const currentMonthStart = startOfMonth(getTodayForTimezone(partnership.timezone));
  const lastCompletedMonthEnd = addDays(currentMonthStart, -1);
  const lastCompletedMonthStart = startOfMonth(lastCompletedMonthEnd);

  return Array.from({ length: 6 }, (_, index) => {
    const monthStart = addMonths(lastCompletedMonthStart, index * -1);
    const monthEnd = endOfMonth(monthStart);
    const dateFrom = toDateInput(monthStart);
    const dateTo = toDateInput(monthEnd);
    const periodGrain = 'calendar_month' as PartnerDashboardPeriodGrain;

    return {
      key: getPartnerPeriodKey(periodGrain, dateFrom, dateTo),
      mode,
      label: formatPartnerPeriod({ periodStart: dateFrom, periodEnd: dateTo }, mode),
      dateFrom,
      dateTo,
      periodGrain,
    };
  });
};

const getPartnerTrendRange = (period: PartnerPeriodOption | undefined) => {
  if (!period) return null;

  const selectedStart = parseDateInput(period.dateFrom);
  const trendStart =
    period.mode === 'monthly'
      ? startOfMonth(addMonths(selectedStart, -5))
      : addDays(selectedStart, -49);

  return {
    dateFrom: toDateInput(trendStart),
    dateTo: period.dateTo,
    periodGrain: period.periodGrain,
  };
};

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
) =>
  periodMode === 'weekly'
    ? formatDateRange(period.periodStart, period.periodEnd)
    : formatMonth(period.periodStart);

const getPartnerPeriodNoun = (periodMode: PartnerPeriodMode) =>
  periodMode === 'weekly' ? 'week' : 'month';

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

const formatPayoutBasisDetail = (period: PartnerDashboardTotals) =>
  usesNetSalesAsPayoutBasis(period)
    ? 'Payout basis'
    : `Payout basis ${formatCurrency(period.splitBaseCents, true)}`;

const formatTaxDeductionsDetail = (period: PartnerDashboardTotals) =>
  hasAdditionalCosts(period)
    ? `Additional costs ${formatCurrency(period.costCents, true)}`
    : 'Tax and configured deductions';

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

export default function ReportsPage() {
  const { isSuperAdmin } = useAuth();
  const { t } = useLanguage();
  const [activeView, setActiveView] = useState<ReportingView>('operator');

  const { data: accessContext = emptyReportingAccessContext, isFetching: accessFetching } =
    useQuery({
      queryKey: ['reporting-access-context'],
      queryFn: fetchReportingAccessContext,
      staleTime: 1000 * 60,
  });

  useEffect(() => {
    if (!isSuperAdmin && activeView === 'partner') {
      setActiveView('operator');
    }
  }, [activeView, isSuperAdmin]);

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title={t('reports.title')}
            description={t('reports.description')}
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
                    : t('reports.operatorReporting'),
                tone: isSuperAdmin ? 'accent' : 'default',
              },
            ]}
            actions={
              isSuperAdmin ? (
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
                    {t('reports.partnerDashboard')}
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : undefined
            }
          />

          <div className="mt-6">
            {activeView === 'partner' && isSuperAdmin ? (
              <PartnerDashboardView />
            ) : (
              <OperatorReportingView accessContext={accessContext} />
            )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

function OperatorReportingView({ accessContext }: { accessContext: ReportingAccessContext }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
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

  const chartRows = useMemo(
    () =>
      groupRows(reportRows, (row) => row.periodStart, (row) => formatShortDate(row.periodStart))
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((row) => ({
          period: row.label,
          netSales: row.netSalesCents / 100,
        })),
    [reportRows]
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

  const refreshReport = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sales-report'] }),
      queryClient.invalidateQueries({ queryKey: ['reporting-dimensions'] }),
      queryClient.invalidateQueries({ queryKey: ['reporting-access-context'] }),
    ]);
  };

  const exportPdf = async () => {
    setIsExporting(true);
    try {
      const exportResult = await exportSalesReportPdf({
        ...filters,
        title: `Bloomjoy operator sales report ${dateFrom} to ${dateTo}`,
      });
      toast.success('Sales report PDF is ready.');
      window.open(exportResult.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (exportError) {
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
              <Button variant="outline" onClick={refreshReport} disabled={isFetching}>
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t('reports.refresh')}
              </Button>
              <Button onClick={exportPdf} disabled={isExporting || reportRows.length === 0}>
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
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="flex flex-col gap-2">
              <Label>{t('reports.period')}</Label>
              <ToggleGroup
                type="single"
                value={periodPreset}
                onValueChange={(value) => {
                  if (value) applyPeriodPreset(value as OperatorPeriodPreset);
                }}
                className="grid grid-cols-2 items-stretch rounded-lg border border-border bg-background p-1 sm:grid-cols-5"
              >
                <ToggleGroupItem value="this_week" className="h-9 rounded-md text-xs sm:text-sm">
                  {t('reports.thisWeek')}
                </ToggleGroupItem>
                <ToggleGroupItem value="last_week" className="h-9 rounded-md text-xs sm:text-sm">
                  {t('reports.lastWeek')}
                </ToggleGroupItem>
                <ToggleGroupItem value="last_30_days" className="h-9 rounded-md text-xs sm:text-sm">
                  {t('reports.last30Days')}
                </ToggleGroupItem>
                <ToggleGroupItem value="month_to_date" className="h-9 rounded-md text-xs sm:text-sm">
                  {t('reports.monthToDate')}
                </ToggleGroupItem>
                <ToggleGroupItem value="custom" className="h-9 rounded-md text-xs sm:text-sm">
                  {t('reports.custom')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <LabeledControl label={t('reports.from')}>
                <Input
                  type="date"
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
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPeriodPreset('custom');
                  }}
                />
              </LabeledControl>
              <LabeledControl label={t('reports.view')}>
                <Select value={grain} onValueChange={(value) => setGrain(value as ReportGrain)}>
                  <SelectTrigger className="min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="day">{t('reports.daily')}</SelectItem>
                      <SelectItem value="week">{t('reports.weekly')}</SelectItem>
                      <SelectItem value="month">{t('reports.monthly')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LabeledControl>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
            <LabeledControl label={t('reports.machine')}>
              <Select value={machineId} onValueChange={setMachineId}>
                <SelectTrigger className="min-w-0">
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
              <Label>{t('reports.payment')}</Label>
              <ToggleGroup
                type="multiple"
                value={selectedPayments}
                onValueChange={(value) => setSelectedPayments(value as PaymentMethod[])}
                className="grid grid-cols-2 rounded-lg border border-border bg-background p-1 sm:grid-cols-4"
              >
                {paymentMethods.map((paymentMethod) => (
                  <ToggleGroupItem
                    key={paymentMethod}
                    value={paymentMethod}
                    className="h-9 rounded-md text-sm"
                  >
                    {t(paymentMethodLabelKeys[paymentMethod])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              value={formatCurrency(summary.netSalesCents)}
              context={t('reports.averageOrder', { value: formatCurrency(averageOrderCents) })}
            />
            <MetricCard
              label={t('reports.grossSales')}
              value={formatCurrency(summary.grossSalesCents)}
              context={t('reports.netPlusRefunds')}
            />
            <MetricCard
              label={t('reports.refundImpact')}
              value={formatCurrency(summary.refundAmountCents)}
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
                    primary={formatCurrency(row.netSalesCents)}
                    secondary={`${t('reports.grossSales')} ${formatCurrency(row.grossSalesCents)}`}
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
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('reports.period')}</TableHead>
                      <TableHead>{t('reports.machine')}</TableHead>
                      <TableHead>{t('reports.payment')}</TableHead>
                      <TableHead className="text-right">{t('reports.netSales')}</TableHead>
                      <TableHead className="text-right">{t('reports.grossSales')}</TableHead>
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
                        <TableCell className="text-right">{formatCurrency(row.netSalesCents)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.grossSalesCents)}</TableCell>
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

function PartnerDashboardView() {
  const queryClient = useQueryClient();
  const [periodMode, setPeriodMode] = useState<PartnerPeriodMode>('weekly');
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');
  const [selectedPartnershipId, setSelectedPartnershipId] = useState('');
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
      preview?.periods.find(
        (period) =>
          period.periodStart === selectedPeriod?.dateFrom &&
          period.periodEnd === selectedPeriod?.dateTo
      ) ?? preview?.periods[0],
    [preview?.periods, selectedPeriod?.dateFrom, selectedPeriod?.dateTo]
  );

  const trendPeriods = useMemo(
    () =>
      [...(trendPreview?.periods ?? [])].sort((left, right) =>
        left.periodStart.localeCompare(right.periodStart)
      ),
    [trendPreview?.periods]
  );
  const currentPeriod = selectedPreviewPeriod;
  const previousPeriod = useMemo(() => {
    if (!selectedPeriod) return undefined;
    const priorPeriods = trendPeriods.filter(
      (period) => period.periodEnd < selectedPeriod.dateTo
    );
    return priorPeriods[priorPeriods.length - 1];
  }, [selectedPeriod, trendPeriods]);
  const displayPeriods = useMemo(
    () => {
      if (!currentPeriod) return trendPeriods;
      if (trendPeriods.length === 0) return [currentPeriod];

      let includesSelectedPeriod = false;
      const periods = trendPeriods.map((period) => {
        const isSelectedPeriod =
          period.periodStart === currentPeriod.periodStart &&
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
    [currentPeriod, trendPeriods]
  );

  const machineRows = useMemo(
    () => buildPartnerMachineRows(preview, currentPeriod, previousPeriod, trendPreview),
    [currentPeriod, preview, previousPeriod, trendPreview]
  );
  const showPayoutBasisColumn = shouldShowPayoutBasisColumn(machineRows);

  const netSalesTrendData = useMemo(
    () =>
      displayPeriods.map((period) => ({
        period: formatPartnerPeriod(period, periodMode),
        netSales: period.netSalesCents / 100,
      })),
    [displayPeriods, periodMode]
  );

  const blockingWarnings = useMemo(
    () => preview?.warnings.filter(isReportingTabWarning) ?? [],
    [preview?.warnings]
  );
  const nonBlockingWarnings = useMemo(
    () => preview?.warnings.filter((warning) => !isReportingTabWarning(warning)) ?? [],
    [preview?.warnings]
  );
  const hasBlockingWarnings = blockingWarnings.length > 0;
  const previewFetching = selectedPreviewFetching || trendPreviewFetching;
  const trendLabel = periodMode === 'weekly' ? 'Weekly' : 'Monthly';
  const selectedPeriodSummaryLabel = selectedPeriod
    ? periodMode === 'weekly'
      ? `Selected week ending ${formatDate(selectedPeriod.dateTo)}`
      : `Selected month ${formatMonth(selectedPeriod.dateFrom)}`
    : 'No completed period';
  const selectedPeriodEmptyMessage = !selectedPartnershipId
    ? 'Select a partnership'
    : periodOptions.length === 0
      ? `No completed ${getPartnerPeriodNoun(periodMode)}s available`
      : 'Select a completed period';
  const selectedPeriodSummaryRange = selectedPeriod
    ? `${formatDate(selectedPeriod.dateFrom)} through ${formatDate(selectedPeriod.dateTo)}`
    : selectedPeriodEmptyMessage;
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

  const refreshPartnerDashboard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partner-dashboard-partnerships'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-dashboard-period-preview'] }),
    ]);
  };

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
      toast.error('Resolve blocking admin review items before exporting the partner report.');
      return;
    }

    setExportingPartnerFormat(format);
    try {
      const exportPeriodLabel = currentPeriod
        ? formatPartnerPeriod(currentPeriod, periodMode)
        : selectedPeriod?.label;
      const exportResult = await exportPartnerDashboardReport({
        partnershipId: preview.partnershipId,
        periodGrain: selectedPeriod?.periodGrain ?? preview.periodGrain,
        dateFrom: currentPeriod.periodStart,
        dateTo: currentPeriod.periodEnd,
        format,
      });
      window.open(exportResult.signedUrl, '_blank', 'noopener,noreferrer');
      const exportFormatLabel =
        format === 'pdf' ? 'PDF' : format === 'xlsx' ? 'Excel workbook' : 'CSV';
      toast.success(
        `${trendLabel} partner ${exportFormatLabel} generated for ${exportPeriodLabel}.`
      );
    } catch (error) {
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
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Unable to load partner dashboard setup</AlertTitle>
        <AlertDescription>
          The partner dashboard uses admin-only reporting setup data. Refresh or check the setup RPC.
        </AlertDescription>
      </Alert>
    );
  }

  if (partnerships.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No active partnerships yet</CardTitle>
          <CardDescription>
            Add an active partnership, assign machines, and configure financial rules before the
            dashboard can preview settlement math.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/admin/partnerships">Open partnership setup</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6 print:hidden">
        <Card>
          <CardContent className="grid gap-4 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(180px,0.55fr)_minmax(220px,0.75fr)_auto] lg:items-end">
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
                    if (value === 'weekly' || value === 'monthly') setPeriodMode(value);
                  }}
                  className="grid grid-cols-2 rounded-lg border border-border bg-background p-1"
                >
                  <ToggleGroupItem value="weekly" className="h-9 rounded-md text-sm">
                    Weekly
                  </ToggleGroupItem>
                  <ToggleGroupItem value="monthly" className="h-9 rounded-md text-sm">
                    Monthly
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <LabeledControl label="Completed period" htmlFor="partner-dashboard-period">
                <Select
                  value={selectedPeriod?.key ?? ''}
                  onValueChange={setSelectedPeriodKey}
                  disabled={periodOptions.length === 0}
                >
                  <SelectTrigger id="partner-dashboard-period">
                    <SelectValue placeholder={`Select ${periodMode === 'weekly' ? 'week' : 'month'}`} />
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

              <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                <Button
                  variant="outline"
                  onClick={refreshPartnerDashboard}
                  disabled={previewFetching}
                >
                  {previewFetching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={partnerExportDisabled} className="justify-center">
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
                          Partner-ready settlement packet.
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

            <div
              aria-live="polite"
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground sm:flex sm:items-center sm:justify-between sm:gap-4"
            >
              <span className="font-medium text-foreground">{selectedPeriodSummaryLabel}</span>
              <span className="block sm:text-right">{selectedPeriodSummaryRange}</span>
            </div>
          </CardContent>
        </Card>

      {previewError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unable to load partner preview</AlertTitle>
          <AlertDescription>
            {previewError instanceof Error
              ? previewError.message
              : 'Check the partnership setup and try again.'}
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
          <PartnerAnswerBand
            preview={preview}
            currentPeriod={currentPeriod}
            previousPeriod={previousPeriod}
            trendLabel={trendLabel}
            periodMode={periodMode}
          />

          {(blockingWarnings.length > 0 || nonBlockingWarnings.length > 0) && (
            <Alert className="border-amber/20 bg-amber/10 text-foreground">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {blockingWarnings.length > 0 ? 'Report setup needs attention' : 'Period review notes'}
              </AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex flex-col gap-2">
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
                  {blockingWarnings.length > 0 && (
                    <Button asChild variant="outline" size="sm" className="w-fit">
                      <Link to="/admin/partnerships">Open admin setup</Link>
                    </Button>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid min-w-0 gap-6">
            <PartnerTrendCard
              title="Net sales trend"
              description={`${trendLabel} net sales across the selected partnership.`}
              data={netSalesTrendData}
              config={partnerNetSalesChartConfig}
              dataKey="netSales"
              value={formatCurrency(currentPeriod?.netSalesCents ?? 0)}
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
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-xl">Machine rollups</CardTitle>
                <CardDescription>
                  Selected {getPartnerPeriodNoun(periodMode)} compared with the previous period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {machineRows.length === 0 ? (
                  <EmptyPanel title="No machine rollups" description="Assign machines and import sales before this table can show partner performance." />
                ) : (
                  <>
                    <div className="flex flex-col gap-3 md:hidden">
                      {machineRows.map((row) => (
                        <PartnerMachineMobileCard key={row.current.reportingMachineId} row={row} />
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
                            <TableHead className="text-right">Amount owed</TableHead>
                            <TableHead className="text-right">Change</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {machineRows.map((row) => {
                            const TrendIcon = getTrendIcon(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0);
                            return (
                              <TableRow key={row.current.reportingMachineId}>
                                <TableCell>
                                  <div className="font-medium">{row.current.machineLabel}</div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(row.current.grossSalesCents)}
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

            <PartnerCalculationCard
              summary={currentPeriod ?? preview.summary}
              periodLabel={
                currentPeriod
                  ? formatPartnerPeriod(currentPeriod, periodMode)
                  : `${formatDate(preview.dateFrom)} - ${formatDate(preview.dateTo)}`
              }
            />
          </div>
        </>
      ) : (
        <EmptyPanel title="Select a partnership" description="Choose an active partnership to load the partner dashboard preview." />
      )}
      </div>
      {preview && !hasBlockingWarnings && (
        <PartnerPrintableReport
          preview={preview}
          periods={displayPeriods}
          machineRows={machineRows}
          currentPeriod={currentPeriod}
          previousPeriod={previousPeriod}
          periodMode={periodMode}
        />
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
}: {
  preview: PartnerDashboardPeriodPreview;
  currentPeriod: PartnerDashboardPeriod | undefined;
  previousPeriod: PartnerDashboardPeriod | undefined;
  trendLabel: string;
  periodMode: PartnerPeriodMode;
}) {
  const current = currentPeriod ?? preview.summary;
  const previous = previousPeriod;
  const periodLabel = currentPeriod
    ? formatPartnerPeriod(currentPeriod, periodMode)
    : `${formatDate(preview.dateFrom)} - ${formatDate(preview.dateTo)}`;
  const periodNoun = getPartnerPeriodNoun(periodMode);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">Partner performance summary</CardTitle>
        <CardDescription>
          {preview.partnershipName} - {periodLabel} - {trendLabel} view
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 p-5 pt-0 md:grid-cols-2 xl:grid-cols-5">
        <AnswerItem
          label="Amount owed"
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

function PartnerPrintableReport({
  preview,
  periods,
  machineRows,
  currentPeriod,
  previousPeriod,
  periodMode,
}: {
  preview: PartnerDashboardPeriodPreview;
  periods: PartnerDashboardPeriod[];
  machineRows: PartnerMachineComparisonRow[];
  currentPeriod: PartnerDashboardPeriod | undefined;
  previousPeriod: PartnerDashboardPeriod | undefined;
  periodMode: PartnerPeriodMode;
}) {
  const current = currentPeriod ?? preview.summary;
  const currentHasAdditionalCosts = hasAdditionalCosts(current);
  const currentUsesNetSalesAsPayoutBasis = usesNetSalesAsPayoutBasis(current);
  const periodLabel = currentPeriod
    ? formatPartnerPeriod(currentPeriod, periodMode)
    : `${formatDate(preview.dateFrom)} - ${formatDate(preview.dateTo)}`;
  const generatedAt = new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const modeLabel = periodMode === 'weekly' ? 'Weekly' : 'Monthly';

  return (
    <section className="hidden print:block">
      <style>
        {`
          @media print {
            @page {
              size: letter;
              margin: 0.45in;
            }

            body * {
              visibility: hidden;
            }

            .partner-print-report,
            .partner-print-report * {
              visibility: visible;
            }

            .partner-print-report {
              display: block !important;
              position: absolute;
              top: 0;
              right: 0;
              left: 0;
              width: 100%;
              margin: 0 auto;
            }
          }
        `}
      </style>
      <div className="partner-print-report mx-auto flex w-full max-w-none flex-col gap-6 p-8 text-foreground">
        <header className="flex items-start justify-between gap-6 border-b border-border pb-5">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Bloomjoy
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">
              Partner performance report
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.partnershipName} - {periodLabel}
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div className="font-medium text-foreground">{modeLabel} report</div>
            <div>Generated {generatedAt}</div>
            <div>
              Data range {formatDate(preview.dateFrom)} - {formatDate(preview.dateTo)}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-5 gap-3">
          <PrintableMetric
            label="Amount owed"
            value={formatCurrency(current.amountOwedCents, true)}
            detail={`${formatPercentChange(current.amountOwedCents, previousPeriod?.amountOwedCents ?? 0)} vs prior`}
            emphasis
          />
          <PrintableMetric
            label="Gross sales"
            value={formatCurrency(current.grossSalesCents, true)}
            detail={`${formatPercentChange(current.grossSalesCents, previousPeriod?.grossSalesCents ?? 0)} vs prior`}
          />
          <PrintableMetric
            label="Refund impact"
            value={`-${formatCurrency(current.refundAmountCents, true)}`}
            detail="Applied adjustments"
          />
          <PrintableMetric
            label="Net sales"
            value={formatCurrency(current.netSalesCents, true)}
            detail="After tax, refunds, and deductions"
          />
          <PrintableMetric
            label="Split base"
            value={formatCurrency(current.splitBaseCents, true)}
            detail={`${numberFormatter.format(current.orderCount)} transactions`}
          />
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{modeLabel} sales trend</h2>
            <p className="text-sm text-muted-foreground">
              Gross sales, refund impact, net sales, volume, and amount owed across the selected period.
            </p>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Gross sales</th>
                <th className="px-3 py-2 text-right font-medium">Refunds</th>
                <th className="px-3 py-2 text-right font-medium">Net sales</th>
                <th className="px-3 py-2 text-right font-medium">Transactions</th>
                <th className="px-3 py-2 text-right font-medium">Items</th>
                <th className="py-2 pl-3 text-right font-medium">Amount owed</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.periodStart} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium text-foreground">
                    {formatPartnerPeriod(period, periodMode)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(period.grossSalesCents, true)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    -{formatCurrency(period.refundAmountCents, true)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(period.netSalesCents, true)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {numberFormatter.format(period.orderCount)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {numberFormatter.format(period.itemQuantity)}
                  </td>
                  <td className="py-2 pl-3 text-right font-medium text-foreground">
                    {formatCurrency(period.amountOwedCents, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Machine rollup</h2>
            <p className="text-sm text-muted-foreground">
              Selected {getPartnerPeriodNoun(periodMode)} performance by assigned machine.
            </p>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Machine</th>
                <th className="px-3 py-2 text-right font-medium">Gross sales</th>
                <th className="px-3 py-2 text-right font-medium">Refunds</th>
                <th className="px-3 py-2 text-right font-medium">Volume</th>
                <th className="px-3 py-2 text-right font-medium">Net sales</th>
                <th className="px-3 py-2 text-right font-medium">Amount owed</th>
                <th className="py-2 pl-3 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {machineRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No machine sales found for this period.
                  </td>
                </tr>
              ) : (
                machineRows.map((row) => (
                  <tr key={row.current.reportingMachineId} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-foreground">{row.current.machineLabel}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.current.grossSalesCents, true)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      -{formatCurrency(row.current.refundAmountCents, true)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div>{numberFormatter.format(periodVolume(row.current))} items</div>
                      <div className="text-xs text-muted-foreground">
                        {numberFormatter.format(row.current.orderCount)} transactions
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.current.netSalesCents, true)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">
                      {formatCurrency(row.current.amountOwedCents, true)}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <div>
                        {formatPercentChange(
                          row.current.grossSalesCents,
                          row.previous?.grossSalesCents ?? 0
                        )}{' '}
                        sales
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatPercentChange(periodVolume(row.current), periodVolume(row.previous))}{' '}
                        volume
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="grid grid-cols-[1fr_1fr] gap-5 border-t border-border pt-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Calculation summary</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Gross sales uses the imported order amount for partner settlement. Machine tax,
              approved refund adjustments, and configured deductions are deducted once to create
              net sales.
              {currentUsesNetSalesAsPayoutBasis
                ? ' Net sales is the payout basis for this period.'
                : ' The active rule then adjusts net sales into the payout basis.'}
              {' '}The partner share is applied to the payout basis to calculate amount owed.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <CalculationLine label="Gross sales" value={formatCurrency(current.grossSalesCents, true)} />
            <CalculationLine label="Refund impact" value={`-${formatCurrency(current.refundAmountCents, true)}`} />
            <CalculationLine label="Tax impact" value={`-${formatCurrency(current.taxCents, true)}`} />
            <CalculationLine label="Configured deductions" value={`-${formatCurrency(current.feeCents, true)}`} />
            {currentHasAdditionalCosts && (
              <CalculationLine label="Additional costs" value={`-${formatCurrency(current.costCents, true)}`} />
            )}
            <CalculationLine label="Net sales" value={formatCurrency(current.netSalesCents, true)} />
            {!currentUsesNetSalesAsPayoutBasis && (
              <CalculationLine label="Payout basis" value={formatCurrency(current.splitBaseCents, true)} />
            )}
            <CalculationLine
              label="Amount owed"
              value={formatCurrency(current.amountOwedCents, true)}
              emphasis
            />
          </div>
        </section>
      </div>
    </section>
  );
}

function PrintableMetric({
  label,
  value,
  detail,
  emphasis = false,
}: {
  label: string;
  value: string;
  detail: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-2 text-xl font-semibold text-foreground', emphasis && 'text-sage')}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function PartnerMachineMobileCard({
  row,
}: {
  row: PartnerMachineComparisonRow;
}) {
  const TrendIcon = getTrendIcon(row.current.grossSalesCents, row.previous?.grossSalesCents ?? 0);

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{row.current.machineLabel}</div>
        </div>
        <div className="shrink-0 text-left min-[390px]:text-right">
          <div className="font-semibold text-foreground">
            {formatCurrency(row.current.grossSalesCents)}
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
          label="Amount owed"
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
}: {
  summary: PartnerDashboardTotals;
  periodLabel: string;
}) {
  const summaryHasAdditionalCosts = hasAdditionalCosts(summary);
  const summaryUsesNetSalesAsPayoutBasis = usesNetSalesAsPayoutBasis(summary);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-xl">Calculation</CardTitle>
        <CardDescription>{periodLabel} settlement calculation.</CardDescription>
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
          label="Amount owed"
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
            Gross sales uses the imported order amount for partner settlement. Machine tax,
            approved refund adjustments, and configured deductions are deducted once to create net
            sales.
            {summaryUsesNetSalesAsPayoutBasis
              ? ' Net sales is the payout basis for this period.'
              : ' The active rule then adjusts net sales into the payout basis.'}
            {' '}The partner share is applied to the payout basis to calculate amount owed.
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
          value={formatCurrency(row.netSalesCents)}
          detail={`${numberFormatter.format(row.transactionCount)} ${t('reports.transactions').toLowerCase()}`}
        />
        <MobileProofItem
          label={t('reports.grossSales')}
          value={formatCurrency(row.grossSalesCents)}
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
