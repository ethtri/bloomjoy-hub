import type {
  PartnerDashboardMachinePeriod,
  PartnerDashboardPeriod,
  PartnerDashboardPeriodMode,
  PartnerDashboardPeriodPreview,
  PartnerDashboardTotals,
} from '@/lib/partnerDashboardReporting';
import { cn } from '@/lib/utils';

type PartnerMachineComparisonRow = {
  current: PartnerDashboardMachinePeriod;
  previous?: PartnerDashboardMachinePeriod;
};

type PartnerPrintableReportProps = {
  preview: PartnerDashboardPeriodPreview;
  periods: PartnerDashboardPeriod[];
  machineRows: PartnerMachineComparisonRow[];
  currentPeriod: PartnerDashboardPeriod | undefined;
  previousPeriod: PartnerDashboardPeriod | undefined;
  periodMode: PartnerDashboardPeriodMode;
  selectedMachineLabel?: string;
  isInProgressPeriod: boolean;
};

const PARTNER_REVENUE_SHARE_LABEL = 'Partner Revenue Share';

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

const parseDateInput = (value: string) => new Date(`${value}T00:00:00`);

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
  periodMode: PartnerDashboardPeriodMode
) => {
  if (periodMode === 'weekly') return formatDateRange(period.periodStart, period.periodEnd);
  if (periodMode === 'month_to_date') return `${formatDateRange(period.periodStart, period.periodEnd)} MTD`;
  return formatMonth(period.periodStart);
};

const getPartnerModeLabel = (periodMode: PartnerDashboardPeriodMode) => {
  if (periodMode === 'weekly') return 'Weekly';
  if (periodMode === 'month_to_date') return 'Month to date';
  return 'Completed month';
};

const getPartnerPeriodNoun = (periodMode: PartnerDashboardPeriodMode) =>
  periodMode === 'weekly' ? 'week' : 'month';

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

function PartnerPrintableReport({
  preview,
  periods,
  machineRows,
  currentPeriod,
  previousPeriod,
  periodMode,
  selectedMachineLabel,
  isInProgressPeriod,
}: PartnerPrintableReportProps) {
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
  const modeLabel = getPartnerModeLabel(periodMode);
  const scopeLabel = selectedMachineLabel ?? 'All machines';

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
              {preview.partnershipName} - {scopeLabel} - {periodLabel}
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div className="font-medium text-foreground">
              {modeLabel} report{isInProgressPeriod ? ' (in progress)' : ''}
            </div>
            <div>Generated {generatedAt}</div>
            <div>
              Data range {formatDate(preview.dateFrom)} - {formatDate(preview.dateTo)}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-5 gap-3">
          <PrintableMetric
            label={PARTNER_REVENUE_SHARE_LABEL}
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
              Gross sales, refund impact, net sales, volume, and Partner Revenue Share across the selected period.
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
                <th className="py-2 pl-3 text-right font-medium">{PARTNER_REVENUE_SHARE_LABEL}</th>
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
                <th className="px-3 py-2 text-right font-medium">{PARTNER_REVENUE_SHARE_LABEL}</th>
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
              Gross sales uses the imported order amount for partner reporting. Machine tax,
              approved refund adjustments, and configured deductions are deducted once to create
              net sales.
              {currentUsesNetSalesAsPayoutBasis
                ? ' Net sales is the payout basis for this period.'
                : ' The active rule then adjusts net sales into the payout basis.'}
              {' '}The configured share is applied to the payout basis to calculate Partner Revenue Share.
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
              label={PARTNER_REVENUE_SHARE_LABEL}
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

export default PartnerPrintableReport;
