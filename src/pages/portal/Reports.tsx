import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import {
  exportSalesReportPdf,
  fetchReportingAccessContext,
  fetchReportingDimensions,
  fetchSalesReport,
  summarizeSalesReport,
  type PaymentMethod,
  type ReportGrain,
  type SalesReportFilters,
  type SalesReportRow,
} from '@/lib/reporting';

const paymentMethods: PaymentMethod[] = ['cash', 'credit', 'other', 'unknown'];

const chartConfig = {
  netSales: { label: 'Net sales', color: 'hsl(var(--primary))' },
  grossSales: { label: 'Gross sales', color: 'hsl(var(--sage))' },
} satisfies ChartConfig;

const toDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDefaultDateFrom = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return toDateInput(date);
};

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);

const formatDate = (value: string | null) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'n/a';

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
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom);
  const [dateTo, setDateTo] = useState(() => toDateInput(new Date()));
  const [grain, setGrain] = useState<ReportGrain>('week');
  const [machineId, setMachineId] = useState('all');
  const [locationId, setLocationId] = useState('all');
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
  const { data: accessContext } = useQuery({
    queryKey: ['reporting-access-context'],
    queryFn: fetchReportingAccessContext,
    staleTime: 1000 * 60,
  });

  const filters: SalesReportFilters = useMemo(
    () => ({
      dateFrom,
      dateTo,
      grain,
      machineIds: machineId === 'all' ? [] : [machineId],
      locationIds: locationId === 'all' ? [] : [locationId],
      paymentMethods: selectedPayments,
    }),
    [dateFrom, dateTo, grain, locationId, machineId, selectedPayments]
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

  const locations = useMemo(() => {
    const byId = new Map<string, string>();
    dimensions.forEach((dimension) => byId.set(dimension.locationId, dimension.locationName));
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [dimensions]);

  const summary = useMemo(() => summarizeSalesReport(reportRows), [reportRows]);
  const chartRows = useMemo(
    () =>
      groupRows(reportRows, (row) => row.periodStart, (row) => formatDate(row.periodStart))
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((row) => ({
          period: row.label,
          netSales: row.netSalesCents / 100,
          grossSales: row.grossSalesCents / 100,
        })),
    [reportRows]
  );
  const machineRows = useMemo(
    () => groupRows(reportRows, (row) => row.machineId, (row) => row.machineLabel),
    [reportRows]
  );

  const refreshReport = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sales-report'] }),
      queryClient.invalidateQueries({ queryKey: ['reporting-dimensions'] }),
    ]);
  };

  const togglePaymentMethod = (paymentMethod: PaymentMethod) => {
    setSelectedPayments((current) =>
      current.includes(paymentMethod)
        ? current.filter((value) => value !== paymentMethod)
        : [...current, paymentMethod]
    );
  };

  const exportPdf = async () => {
    setIsExporting(true);
    try {
      const exportResult = await exportSalesReportPdf({
        ...filters,
        title: `Bloomjoy sales report ${dateFrom} to ${dateTo}`,
      });
      toast.success('Sales report PDF is ready.');
      window.open(exportResult.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : 'Unable to export report.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title="Sales Reports"
            description="Review entitled machine sales by period, location, machine, and payment method. Gross sales adds refund adjustments back to Sunze net sales until the source definition is validated."
            badges={[
              { label: `${dimensions.length} machines available`, tone: 'muted' },
              {
                label: `Latest sale ${formatDate(accessContext?.latestSaleDate ?? null)}`,
                tone: 'muted',
              },
              {
                label: `Last import ${formatDateTime(accessContext?.latestImportCompletedAt)}`,
                tone: 'muted',
              },
              { label: isFetching ? 'Refreshing' : 'Ready for export', tone: 'default' },
            ]}
            actions={
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
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
            }
          />

          {(error || dimensionsError) && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load sales reporting data. Please try again.
            </div>
          )}

          <div className="mt-6 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)]">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <label className="text-sm font-medium text-foreground">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  From
                </span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  To
                </span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  View
                </span>
                <select
                  value={grain}
                  onChange={(event) => setGrain(event.target.value as ReportGrain)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                </select>
              </label>
              <label className="text-sm font-medium text-foreground">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Location
                </span>
                <select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All locations</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-foreground">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Machine
                </span>
                <select
                  value={machineId}
                  onChange={(event) => setMachineId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All machines</option>
                  {dimensions.map((dimension) => (
                    <option key={dimension.machineId} value={dimension.machineId}>
                      {dimension.machineLabel}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {paymentMethods.map((paymentMethod) => {
                const active = selectedPayments.includes(paymentMethod);
                return (
                  <button
                    key={paymentMethod}
                    type="button"
                    onClick={() => togglePaymentMethod(paymentMethod)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? 'border-primary/20 bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {paymentMethod}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Net Sales
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {formatCurrency(summary.netSalesCents)}
              </p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Refund Adjustments
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {formatCurrency(summary.refundAmountCents)}
              </p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Gross Sales
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {formatCurrency(summary.grossSalesCents)}
              </p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Transactions
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {summary.transactionCount.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-foreground">Sales by Period</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Net and gross sales for the selected date grain.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                {isLoading ? (
                  <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                    Loading report...
                  </div>
                ) : chartRows.length === 0 ? (
                  <div className="flex h-72 items-center justify-center text-center text-sm text-muted-foreground">
                    No sales rows match the selected filters.
                  </div>
                ) : (
                  <ChartContainer config={chartConfig} className="h-72 w-full">
                    <BarChart data={chartRows}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="period" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={48} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="netSales" fill="var(--color-netSales)" radius={[4, 4, 0, 0]} />
                      <Bar
                        dataKey="grossSales"
                        fill="var(--color-grossSales)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <h2 className="font-semibold text-foreground">Sales by Machine</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Useful for partner weekly rollups such as Bubble Planet.
              </p>
              <div className="mt-5 space-y-3">
                {machineRows.length === 0 ? (
                  <div className="rounded-lg border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                    No machine rows yet.
                  </div>
                ) : (
                  machineRows.map((row) => (
                    <div
                      key={row.key}
                      className="rounded-lg border border-border bg-background p-4 text-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{row.label}</p>
                          <p className="mt-1 text-muted-foreground">
                            {row.transactionCount.toLocaleString()} transactions
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-foreground">
                            {formatCurrency(row.netSalesCents)}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            Gross {formatCurrency(row.grossSalesCents)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="min-w-[760px] w-full">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Period
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Machine
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Net
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Gross
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No rows found.
                    </td>
                  </tr>
                ) : (
                  reportRows.map((row) => (
                    <tr
                      key={`${row.periodStart}-${row.machineId}-${row.paymentMethod}`}
                      className="border-b border-border/70"
                    >
                      <td className="px-4 py-3 text-sm text-foreground">
                        {formatDate(row.periodStart)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{row.machineLabel}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.locationName}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.paymentMethod}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-foreground">
                        {formatCurrency(row.netSalesCents)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-foreground">
                        {formatCurrency(row.grossSalesCents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
