import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Download,
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
  fetchPartnerDashboardPartnerships,
  fetchPartnerDashboardPeriodPreview,
  type PartnerDashboardMachinePeriod,
  type PartnerDashboardPartnershipOption,
  type PartnerDashboardPeriod,
  type PartnerDashboardPeriodGrain,
  type PartnerDashboardPeriodPreview,
  type PartnerDashboardTotals,
} from '@/lib/partnerDashboardReporting';
import { cn } from '@/lib/utils';

type ReportingView = 'operator' | 'partner';
type OperatorPeriodPreset = 'this_week' | 'last_week' | 'last_30_days' | 'month_to_date' | 'custom';
type PartnerPeriodMode = 'weekly' | 'monthly';
type PartnerMachineComparisonRow = {
  current: PartnerDashboardMachinePeriod;
  previous?: PartnerDashboardMachinePeriod;
};

const paymentMethods: PaymentMethod[] = ['cash', 'credit', 'other', 'unknown'];
const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  credit: 'Credit',
  other: 'Other',
  unknown: 'Unknown',
};

const operatorChartConfig = {
  netSales: { label: 'Net sales', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

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

const getLastCompletedWeekEnd = (weekEndDay: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let daysSinceWeekEnd = (today.getDay() - weekEndDay + 7) % 7;
  if (daysSinceWeekEnd === 0) daysSinceWeekEnd = 7;
  return addDays(today, -daysSinceWeekEnd);
};

const getPartnerDateRange = (
  partnership: PartnerDashboardPartnershipOption | undefined,
  mode: PartnerPeriodMode
) => {
  if (!partnership) return null;

  if (mode === 'weekly') {
    const lastWeekEnd = getLastCompletedWeekEnd(partnership.reportingWeekEndDay);
    const firstWeekStart = addDays(lastWeekEnd, -(7 * 7 + 6));
    return {
      dateFrom: toDateInput(firstWeekStart),
      dateTo: toDateInput(lastWeekEnd),
      periodGrain: 'reporting_week' as PartnerDashboardPeriodGrain,
      label: `Last 8 completed weeks ending ${dayNames[partnership.reportingWeekEndDay]}`,
    };
  }

  const currentMonthStart = startOfMonth(new Date());
  const lastCompletedMonthEnd = addDays(currentMonthStart, -1);
  const firstMonthStart = startOfMonth(addMonths(lastCompletedMonthEnd, -5));

  return {
    dateFrom: toDateInput(firstMonthStart),
    dateTo: toDateInput(endOfMonth(lastCompletedMonthEnd)),
    periodGrain: 'calendar_month' as PartnerDashboardPeriodGrain,
    label: 'Last 6 completed months',
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
  const { isAdmin } = useAuth();
  const [activeView, setActiveView] = useState<ReportingView>('operator');

  const { data: accessContext = emptyReportingAccessContext, isFetching: accessFetching } =
    useQuery({
      queryKey: ['reporting-access-context'],
      queryFn: fetchReportingAccessContext,
      staleTime: 1000 * 60,
    });

  useEffect(() => {
    if (!isAdmin && activeView === 'partner') {
      setActiveView('operator');
    }
  }, [activeView, isAdmin]);

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title="Reporting"
            description="Track assigned machine performance, review sales trends, and use the internal partner dashboard when settlement math needs a closer look."
            badges={[
              {
                label: `${accessContext.accessibleMachineCount} machines available`,
                tone: 'muted',
              },
              { label: `Latest sale ${formatDate(accessContext.latestSaleDate)}`, tone: 'muted' },
              {
                label: `Last import ${formatDateTime(accessContext.latestImportCompletedAt)}`,
                tone: 'muted',
              },
              {
                label: accessFetching ? 'Refreshing' : isAdmin ? 'Super-admin reporting' : 'Operator reporting',
                tone: isAdmin ? 'accent' : 'default',
              },
            ]}
            actions={
              isAdmin ? (
                <ToggleGroup
                  type="single"
                  value={activeView}
                  onValueChange={(value) => {
                    if (value === 'operator' || value === 'partner') setActiveView(value);
                  }}
                  className="grid w-full grid-cols-2 rounded-lg border border-border bg-background p-1 sm:w-[340px]"
                >
                  <ToggleGroupItem value="operator" className="h-9 rounded-md text-sm">
                    Operator view
                  </ToggleGroupItem>
                  <ToggleGroupItem value="partner" className="h-9 rounded-md text-sm">
                    Partner dashboard
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : undefined
            }
          />

          <div className="mt-6">
            {activeView === 'partner' && isAdmin ? (
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
  const queryClient = useQueryClient();
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
          <AlertTitle>Unable to load reporting data</AlertTitle>
          <AlertDescription>
            Check the selected filters and try refreshing. Your filter choices will stay in place.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-xl">Operator performance</CardTitle>
              <CardDescription>
                Sales and transaction trends for the machines assigned to this account.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={refreshReport} disabled={isFetching}>
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
              <Button onClick={exportPdf} disabled={isExporting || reportRows.length === 0}>
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="flex flex-col gap-2">
              <Label>Period</Label>
              <ToggleGroup
                type="single"
                value={periodPreset}
                onValueChange={(value) => {
                  if (value) applyPeriodPreset(value as OperatorPeriodPreset);
                }}
                className="grid grid-cols-2 items-stretch rounded-lg border border-border bg-background p-1 sm:grid-cols-5"
              >
                <ToggleGroupItem value="this_week" className="h-9 rounded-md text-xs sm:text-sm">
                  This week
                </ToggleGroupItem>
                <ToggleGroupItem value="last_week" className="h-9 rounded-md text-xs sm:text-sm">
                  Last week
                </ToggleGroupItem>
                <ToggleGroupItem value="last_30_days" className="h-9 rounded-md text-xs sm:text-sm">
                  Last 30 days
                </ToggleGroupItem>
                <ToggleGroupItem value="month_to_date" className="h-9 rounded-md text-xs sm:text-sm">
                  Month to date
                </ToggleGroupItem>
                <ToggleGroupItem value="custom" className="h-9 rounded-md text-xs sm:text-sm">
                  Custom
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <LabeledControl label="From">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPeriodPreset('custom');
                  }}
                />
              </LabeledControl>
              <LabeledControl label="To">
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPeriodPreset('custom');
                  }}
                />
              </LabeledControl>
              <LabeledControl label="View">
                <Select value={grain} onValueChange={(value) => setGrain(value as ReportGrain)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="day">Daily</SelectItem>
                      <SelectItem value="week">Weekly</SelectItem>
                      <SelectItem value="month">Monthly</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </LabeledControl>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
            <LabeledControl label="Machine">
              <Select value={machineId} onValueChange={setMachineId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All machines</SelectItem>
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
              <Label>Payment</Label>
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
                    {paymentMethodLabels[paymentMethod]}
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
              label="Net sales"
              value={formatCurrency(summary.netSalesCents)}
              context={`${formatCurrency(averageOrderCents)} average order`}
            />
            <MetricCard
              label="Gross sales"
              value={formatCurrency(summary.grossSalesCents)}
              context="Net plus refund adjustments"
            />
            <MetricCard
              label="Refund impact"
              value={formatCurrency(summary.refundAmountCents)}
              context="Added back for gross view"
            />
            <MetricCard
              label="Transactions"
              value={numberFormatter.format(summary.transactionCount)}
              context={`${dimensions.length} assigned machines`}
            />
          </>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sales trend</CardTitle>
            <CardDescription>
              Net sales for the selected date grain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton />
            ) : chartRows.length === 0 ? (
              <EmptyPanel title="No sales found" description="Widen the period or clear filters to check for activity." />
            ) : (
              <ChartContainer config={operatorChartConfig} className="h-[320px] w-full">
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
            <CardTitle className="text-xl">Machine comparison</CardTitle>
            <CardDescription>
              Ranked by net sales for the selected period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {machineRows.length === 0 ? (
              <EmptyPanel title="No machine rows yet" description="Sales will appear here once the selected filters match imported rows." />
            ) : (
              <div className="flex flex-col gap-3">
                {machineRows.slice(0, 6).map((row) => (
                  <MachineSummaryRow
                    key={row.key}
                    label={row.label}
                    context={`${row.transactionCount.toLocaleString()} transactions`}
                    primary={formatCurrency(row.netSalesCents)}
                    secondary={`Gross ${formatCurrency(row.grossSalesCents)}`}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Report rows</CardTitle>
          <CardDescription>
            Source rows grouped by period, machine, and payment method.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Gross</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No rows found for the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                reportRows.map((row) => (
                  <TableRow key={`${row.periodStart}-${row.machineId}-${row.paymentMethod}`}>
                    <TableCell>{formatDate(row.periodStart)}</TableCell>
                    <TableCell className="font-medium">{row.machineLabel}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {paymentMethodLabels[row.paymentMethod]}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(row.netSalesCents)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.grossSalesCents)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
        Sales data last updated {formatDateTime(accessContext.latestImportCompletedAt)}. Admin-only data quality
        details stay out of the operator view.
      </div>
    </div>
  );
}

function PartnerDashboardView() {
  const queryClient = useQueryClient();
  const [periodMode, setPeriodMode] = useState<PartnerPeriodMode>('weekly');
  const [selectedPartnershipId, setSelectedPartnershipId] = useState('');

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

  const partnerRange = useMemo(
    () => getPartnerDateRange(selectedPartnership, periodMode),
    [periodMode, selectedPartnership]
  );

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: previewFetching,
    error: previewError,
  } = useQuery({
    queryKey: [
      'partner-dashboard-period-preview',
      selectedPartnershipId,
      partnerRange?.periodGrain,
      partnerRange?.dateFrom,
      partnerRange?.dateTo,
    ],
    queryFn: () =>
      fetchPartnerDashboardPeriodPreview({
        partnershipId: selectedPartnershipId,
        dateFrom: partnerRange?.dateFrom ?? '',
        dateTo: partnerRange?.dateTo ?? '',
        periodGrain: partnerRange?.periodGrain ?? 'reporting_week',
      }),
    enabled: Boolean(selectedPartnershipId && partnerRange),
    staleTime: 1000 * 30,
  });

  const sortedPeriods = useMemo(
    () => [...(preview?.periods ?? [])].sort((left, right) => left.periodStart.localeCompare(right.periodStart)),
    [preview?.periods]
  );
  const currentPeriod = sortedPeriods[sortedPeriods.length - 1];
  const previousPeriod = sortedPeriods[sortedPeriods.length - 2];

  const machineRows = useMemo(
    () => buildPartnerMachineRows(preview, currentPeriod, previousPeriod),
    [currentPeriod, preview, previousPeriod]
  );

  const netSalesTrendData = useMemo(
    () =>
      sortedPeriods.map((period) => ({
        period: formatPartnerPeriod(period, periodMode),
        netSales: period.netSalesCents / 100,
      })),
    [periodMode, sortedPeriods]
  );

  const hasBlockingWarnings =
    preview?.warnings.some((warning) => warning.severity === 'blocking') ?? false;
  const trendLabel = periodMode === 'weekly' ? 'Weekly' : 'Monthly';

  const refreshPartnerDashboard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partner-dashboard-partnerships'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-dashboard-period-preview'] }),
    ]);
  };

  const exportPartnerPdf = () => {
    if (!preview) return;
    if (previewFetching) {
      toast.error('Wait for the latest partner dashboard numbers before exporting.');
      return;
    }
    if (hasBlockingWarnings) {
      toast.error('Resolve blocking admin review items before exporting the partner PDF.');
      return;
    }

    toast.success('Opening branded partner report for PDF export.');
    window.setTimeout(() => window.print(), 50);
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
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(220px,0.6fr)_1fr]">
            <LabeledControl label="Partnership">
              <Select value={selectedPartnershipId} onValueChange={setSelectedPartnershipId}>
                <SelectTrigger>
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
              <Label>View</Label>
              <ToggleGroup
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

            <div className="flex items-end">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{partnerRange?.label}</span>
                <span className="block">
                  {partnerRange ? `${formatDate(partnerRange.dateFrom)} through ${formatDate(partnerRange.dateTo)}` : 'Select a partnership'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
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
            <Button
              onClick={exportPartnerPdf}
              disabled={!preview || previewLoading || previewFetching || hasBlockingWarnings}
            >
              <FileText className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
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

          {preview.warnings.length > 0 && (
            <Alert className="border-amber/20 bg-amber/10 text-foreground">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Admin-only data quality review</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex flex-col gap-2">
                  {hasBlockingWarnings && (
                    <div className="font-medium">
                      Partner PDF export is locked until blocking items are resolved.
                    </div>
                  )}
                  {preview.warnings.slice(0, 4).map((warning, index) => (
                    <div key={`${warning.warningType}-${warning.machineId ?? 'scope'}-${index}`}>
                      <Badge variant={warning.severity === 'blocking' ? 'destructive' : 'outline'}>
                        {warning.severity === 'blocking' ? 'Blocking' : 'Review'}
                      </Badge>{' '}
                      {warning.message}
                    </div>
                  ))}
                  {preview.warnings.length > 4 && (
                    <div>{preview.warnings.length - 4} more admin-only warnings hidden.</div>
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
                  Current {periodMode === 'weekly' ? 'week' : 'month'} compared with the previous period.
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
                            <TableHead className="text-right">Volume</TableHead>
                            <TableHead className="text-right">Tax + fees</TableHead>
                            <TableHead className="text-right">Net sales</TableHead>
                            <TableHead className="text-right">Split base</TableHead>
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
                                  <div>{numberFormatter.format(periodVolume(row.current))} items</div>
                                  <div className="text-xs text-muted-foreground">
                                    {numberFormatter.format(row.current.orderCount)} transactions
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div>{formatCurrency(row.current.taxCents + row.current.feeCents, true)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Costs {formatCurrency(row.current.costCents, true)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(row.current.netSalesCents, true)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(row.current.splitBaseCents, true)}
                                </TableCell>
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
          periods={sortedPeriods}
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
  const lowerTrendLabel = trendLabel.toLowerCase();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">Partner performance summary</CardTitle>
        <CardDescription>
          {preview.partnershipName} - {periodLabel} - {trendLabel} view
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 p-5 pt-0 md:grid-cols-2 xl:grid-cols-4">
        <AnswerItem
          label="Amount owed"
          value={formatCurrency(current.amountOwedCents, true)}
          detail={`${formatPercentChange(current.amountOwedCents, previous?.amountOwedCents ?? 0)} vs previous ${lowerTrendLabel}`}
          emphasis
        />
        <AnswerItem
          label="Gross sales"
          value={formatCurrency(current.grossSalesCents, true)}
          detail={`${formatPercentChange(current.grossSalesCents, previous?.grossSalesCents ?? 0)} vs previous ${lowerTrendLabel}`}
        />
        <AnswerItem
          label="Transactions"
          value={numberFormatter.format(current.orderCount)}
          detail={`${numberFormatter.format(current.itemQuantity)} items sold`}
        />
        <AnswerItem
          label="Net sales"
          value={formatCurrency(current.netSalesCents, true)}
          detail="After tax and configured fees"
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
            <ChartContainer config={config} className="h-[320px] w-full">
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

        <section className="grid grid-cols-4 gap-3">
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
            label="Net sales"
            value={formatCurrency(current.netSalesCents, true)}
            detail="After tax and fees"
          />
          <PrintableMetric
            label="Transactions"
            value={numberFormatter.format(current.orderCount)}
            detail={`${numberFormatter.format(current.itemQuantity)} items sold`}
          />
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{modeLabel} sales trend</h2>
            <p className="text-sm text-muted-foreground">
              Net sales, gross sales, volume, and amount owed across the selected period.
            </p>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Gross sales</th>
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
              Current {periodMode === 'weekly' ? 'week' : 'month'} performance by assigned machine.
            </p>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Machine</th>
                <th className="px-3 py-2 text-right font-medium">Gross sales</th>
                <th className="px-3 py-2 text-right font-medium">Volume</th>
                <th className="px-3 py-2 text-right font-medium">Net sales</th>
                <th className="px-3 py-2 text-right font-medium">Amount owed</th>
                <th className="py-2 pl-3 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {machineRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
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
              Gross sales uses the Sunze order amount for partner settlement. Machine tax and
              configured fees are deducted once to create net sales. Configured costs can reduce
              the split base when the active partnership rule uses contribution after costs.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <CalculationLine label="Gross sales" value={formatCurrency(current.grossSalesCents, true)} />
            <CalculationLine label="Tax impact" value={`-${formatCurrency(current.taxCents, true)}`} />
            <CalculationLine label="Fees" value={`-${formatCurrency(current.feeCents, true)}`} />
            <CalculationLine label="Costs" value={`-${formatCurrency(current.costCents, true)}`} />
            <CalculationLine label="Net sales" value={formatCurrency(current.netSalesCents, true)} />
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{row.current.machineLabel}</div>
        </div>
        <div className="shrink-0 text-right">
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

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
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
          detail={`Split ${formatCurrency(row.current.splitBaseCents, true)}`}
        />
        <MobileProofItem
          label="Tax, fees, costs"
          value={formatCurrency(row.current.taxCents + row.current.feeCents, true)}
          detail={`Costs ${formatCurrency(row.current.costCents, true)}`}
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
      <div className="mt-1 font-medium text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
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
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-xl">Calculation</CardTitle>
        <CardDescription>{periodLabel} settlement calculation.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CalculationLine label="Gross sales" value={formatCurrency(summary.grossSalesCents, true)} />
        <CalculationLine label="Tax impact" value={`-${formatCurrency(summary.taxCents, true)}`} />
        <CalculationLine label="Fees" value={`-${formatCurrency(summary.feeCents, true)}`} />
        <CalculationLine label="Costs" value={`-${formatCurrency(summary.costCents, true)}`} />
        <CalculationLine label="Net sales" value={formatCurrency(summary.netSalesCents, true)} />
        <CalculationLine label="Split base" value={formatCurrency(summary.splitBaseCents, true)} />
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
            Gross sales uses the Sunze order amount for partner settlement. Machine tax and
            configured fees are deducted once to create net sales, then the partner share is
            applied to the active split base to calculate amount owed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function buildPartnerMachineRows(
  preview: PartnerDashboardPeriodPreview | undefined,
  currentPeriod: PartnerDashboardPeriod | undefined,
  previousPeriod: PartnerDashboardPeriod | undefined
): PartnerMachineComparisonRow[] {
  if (!preview || !currentPeriod) return [];

  const previousByMachine = new Map<string, PartnerDashboardMachinePeriod>();
  if (previousPeriod) {
    preview.machinePeriods
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

function LabeledControl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
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
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
        <div className="mt-2 text-sm text-muted-foreground">{context}</div>
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{label}</div>
          <div className="mt-1 text-sm text-muted-foreground">{context}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold text-foreground">{primary}</div>
          <div className="mt-1 text-sm text-muted-foreground">{secondary}</div>
        </div>
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
        <div className={cn('text-2xl font-semibold text-foreground', emphasis && 'text-sage')}>
          {value}
        </div>
      )}
      <div className="text-sm text-muted-foreground">{detail}</div>
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
      <div className={cn('text-muted-foreground', emphasis && 'font-medium text-foreground')}>
        {label}
      </div>
      <div className={cn('font-medium text-foreground', emphasis && 'text-lg text-sage')}>
        {value}
      </div>
    </div>
  );
}
