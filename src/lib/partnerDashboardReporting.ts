import { supabaseClient } from '@/lib/supabaseClient';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

export type PartnerDashboardPeriodGrain = 'reporting_week' | 'calendar_month';

export type PartnerDashboardPartnershipOption = {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  reportingWeekEndDay: number;
  timezone: string;
};

export type PartnerDashboardTotals = {
  orderCount: number;
  itemQuantity: number;
  grossSalesCents: number;
  refundAmountCents: number;
  taxCents: number;
  feeCents: number;
  costCents: number;
  netSalesCents: number;
  splitBaseCents: number;
  amountOwedCents: number;
  bloomjoyRetainedCents: number;
};

export type PartnerDashboardPeriod = PartnerDashboardTotals & {
  periodStart: string;
  periodEnd: string;
};

export type PartnerDashboardMachinePeriod = PartnerDashboardTotals & {
  periodStart: string;
  periodEnd: string;
  reportingMachineId: string;
  machineLabel: string;
  locationName: string | null;
};

export type PartnerDashboardWarning = {
  warningType: string;
  severity: 'blocking' | 'non_blocking';
  machineId: string | null;
  machineLabel: string | null;
  message: string;
};

export type PartnerDashboardPeriodPreview = {
  partnershipId: string;
  partnershipName: string;
  periodGrain: PartnerDashboardPeriodGrain;
  dateFrom: string;
  dateTo: string;
  summary: PartnerDashboardTotals;
  periods: PartnerDashboardPeriod[];
  machinePeriods: PartnerDashboardMachinePeriod[];
  warnings: PartnerDashboardWarning[];
};

export type PartnerDashboardExportFormat = 'pdf' | 'csv';

export type PartnerDashboardExportResponse = {
  error?: string;
  snapshotId: string;
  storagePath: string;
  signedUrl: string;
  format: PartnerDashboardExportFormat;
  fileName: string;
  periodGrain: PartnerDashboardPeriodGrain;
  periodStartDate: string;
  periodEndDate: string;
};

type PartnershipSetupRpc = {
  partnerships?: Array<{
    id?: string;
    name?: string;
    status?: 'draft' | 'active' | 'archived';
    reporting_week_end_day?: number;
    timezone?: string;
  }>;
};

type PartnerDashboardTotalsRpc = {
  order_count?: number;
  item_quantity?: number;
  gross_sales_cents?: number;
  refund_amount_cents?: number;
  tax_cents?: number;
  fee_cents?: number;
  cost_cents?: number;
  net_sales_cents?: number;
  split_base_cents?: number;
  amount_owed_cents?: number;
  bloomjoy_retained_cents?: number;
};

type PartnerDashboardPeriodRpc = PartnerDashboardTotalsRpc & {
  period_start?: string;
  period_end?: string;
};

type PartnerDashboardMachinePeriodRpc = PartnerDashboardPeriodRpc & {
  reporting_machine_id?: string;
  machine_label?: string;
  location_name?: string | null;
};

type PartnerDashboardWarningRpc = {
  warning_type?: string;
  severity?: string;
  machine_id?: string | null;
  machine_label?: string | null;
  message?: string;
};

type PartnerDashboardPeriodPreviewRpc = {
  partnership_id?: string;
  partnership_name?: string;
  period_grain?: PartnerDashboardPeriodGrain;
  date_from?: string;
  date_to?: string;
  summary?: PartnerDashboardTotalsRpc;
  periods?: PartnerDashboardPeriodRpc[];
  machine_periods?: PartnerDashboardMachinePeriodRpc[];
  warnings?: PartnerDashboardWarningRpc[];
};

const numberValue = (value: unknown): number => {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
};

const neutralizeProviderCopy = (value: unknown, fallback = '') =>
  String(value ?? fallback)
    .replace(/sunze-sales-ingest/gi, 'sales import endpoint')
    .replace(/sunze-sales-sync/gi, 'sales import workflow')
    .replace(/sunze-orders/gi, 'provider import')
    .replace(/sunze_browser/gi, 'sales import')
    .replace(/\bsunze-[a-z0-9-]+\b/gi, 'sales source')
    .replace(/\b[a-z0-9_]*sunze[a-z0-9_]*\b/gi, 'sales source')
    .replace(/\bSunze\b/gi, 'sales source');

const mapTotals = (record: PartnerDashboardTotalsRpc | undefined): PartnerDashboardTotals => ({
  orderCount: numberValue(record?.order_count),
  itemQuantity: numberValue(record?.item_quantity),
  grossSalesCents: numberValue(record?.gross_sales_cents),
  refundAmountCents: numberValue(record?.refund_amount_cents),
  taxCents: numberValue(record?.tax_cents),
  feeCents: numberValue(record?.fee_cents),
  costCents: numberValue(record?.cost_cents),
  netSalesCents: numberValue(record?.net_sales_cents),
  splitBaseCents: numberValue(record?.split_base_cents),
  amountOwedCents: numberValue(record?.amount_owed_cents),
  bloomjoyRetainedCents: numberValue(record?.bloomjoy_retained_cents),
});

const mapPeriod = (record: PartnerDashboardPeriodRpc): PartnerDashboardPeriod => ({
  periodStart: String(record.period_start ?? ''),
  periodEnd: String(record.period_end ?? ''),
  ...mapTotals(record),
});

const mapMachinePeriod = (
  record: PartnerDashboardMachinePeriodRpc
): PartnerDashboardMachinePeriod => ({
  periodStart: String(record.period_start ?? ''),
  periodEnd: String(record.period_end ?? ''),
  reportingMachineId: String(record.reporting_machine_id ?? ''),
  machineLabel: neutralizeProviderCopy(record.machine_label, 'Unnamed machine'),
  locationName: record.location_name ? neutralizeProviderCopy(record.location_name) : null,
  ...mapTotals(record),
});

const mapWarning = (record: PartnerDashboardWarningRpc): PartnerDashboardWarning => ({
  warningType: String(record.warning_type ?? 'unknown'),
  severity: record.severity === 'non_blocking' ? 'non_blocking' : 'blocking',
  machineId: record.machine_id ?? null,
  machineLabel: record.machine_label ? neutralizeProviderCopy(record.machine_label) : null,
  message: neutralizeProviderCopy(record.message, 'Review this reporting issue before sharing numbers.'),
});

export const fetchPartnerDashboardPartnerships = async (): Promise<
  PartnerDashboardPartnershipOption[]
> => {
  const { data, error } = await supabaseClient.rpc('admin_get_partnership_reporting_setup');

  if (error) {
    throw new Error(error.message || 'Unable to load partner dashboard setup.');
  }

  const setup = (data as PartnershipSetupRpc | null) ?? {};

  return (setup.partnerships ?? [])
    .filter((partnership) => partnership.id && partnership.status === 'active')
    .map((partnership) => ({
      id: partnership.id as string,
      name: neutralizeProviderCopy(partnership.name, 'Unnamed partnership'),
      status: partnership.status ?? 'draft',
      reportingWeekEndDay: Number(partnership.reporting_week_end_day ?? 0),
      timezone: partnership.timezone ?? 'America/Los_Angeles',
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const fetchPartnerDashboardPeriodPreview = async ({
  partnershipId,
  dateFrom,
  dateTo,
  periodGrain,
}: {
  partnershipId: string;
  dateFrom: string;
  dateTo: string;
  periodGrain: PartnerDashboardPeriodGrain;
}): Promise<PartnerDashboardPeriodPreview> => {
  const { data, error } = await supabaseClient.rpc('admin_preview_partner_period_report', {
    p_partnership_id: partnershipId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_period_grain: periodGrain,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load partner dashboard preview.');
  }

  const record = (data as PartnerDashboardPeriodPreviewRpc | null) ?? {};

  return {
    partnershipId: String(record.partnership_id ?? partnershipId),
    partnershipName: neutralizeProviderCopy(record.partnership_name, 'Partnership'),
    periodGrain: record.period_grain ?? periodGrain,
    dateFrom: String(record.date_from ?? dateFrom),
    dateTo: String(record.date_to ?? dateTo),
    summary: mapTotals(record.summary),
    periods: (record.periods ?? []).map(mapPeriod),
    machinePeriods: (record.machine_periods ?? []).map(mapMachinePeriod),
    warnings: (record.warnings ?? []).map(mapWarning),
  };
};

export const exportPartnerDashboardReport = async ({
  partnershipId,
  periodGrain,
  dateFrom,
  dateTo,
  format,
}: {
  partnershipId: string;
  periodGrain: PartnerDashboardPeriodGrain;
  dateFrom: string;
  dateTo: string;
  format: PartnerDashboardExportFormat;
}): Promise<PartnerDashboardExportResponse> => {
  return invokeEdgeFunction<PartnerDashboardExportResponse>(
    'partner-report-export',
    {
      partnershipId,
      periodGrain,
      dateFrom,
      dateTo,
      format,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to export partner reports.',
    }
  );
};
