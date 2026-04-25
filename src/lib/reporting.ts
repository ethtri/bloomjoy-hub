import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import { supabaseClient } from '@/lib/supabaseClient';

export type ReportGrain = 'day' | 'week' | 'month';
export type PaymentMethod = 'cash' | 'credit' | 'other' | 'unknown';
export type ReportingAccessLevel = 'viewer' | 'report_manager';
export type ReportingMachineType = 'commercial' | 'mini' | 'micro' | 'unknown';

export type ReportingAccessContext = {
  hasReportingAccess: boolean;
  accessibleMachineCount: number;
  accessibleLocationCount: number;
  canManageReporting: boolean;
  latestSaleDate: string | null;
  latestImportCompletedAt: string | null;
};

export type ReportingDimension = {
  accountId: string;
  accountName: string;
  locationId: string;
  locationName: string;
  machineId: string;
  machineLabel: string;
  machineType: ReportingMachineType;
  sunzeMachineId: string | null;
  latestSaleDate: string | null;
  status: string;
};

export type SalesReportFilters = {
  dateFrom: string;
  dateTo: string;
  grain: ReportGrain;
  machineIds?: string[];
  locationIds?: string[];
  paymentMethods?: PaymentMethod[];
};

export type SalesReportRow = {
  periodStart: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  paymentMethod: PaymentMethod;
  netSalesCents: number;
  refundAmountCents: number;
  grossSalesCents: number;
  transactionCount: number;
};

export type SalesReportSummary = {
  netSalesCents: number;
  refundAmountCents: number;
  grossSalesCents: number;
  transactionCount: number;
};

export type AdminReportingMachine = {
  id: string;
  account_id: string;
  location_id: string;
  machine_label: string;
  machine_type: ReportingMachineType;
  serial_number: string | null;
  sunze_machine_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  reporting_locations?: { name: string; timezone: string } | null;
  customer_accounts?: { name: string } | null;
};

export type AdminReportingImportRun = {
  id: string;
  source: string;
  status: string;
  source_reference: string | null;
  rows_seen: number;
  rows_imported: number;
  rows_skipped: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export type AdminReportSchedule = {
  id: string;
  title: string;
  schedule_kind: string;
  timezone: string;
  send_day_of_week: number;
  send_hour_local: number;
  report_filters: Record<string, unknown>;
  active: boolean;
  last_sent_at: string | null;
  created_at: string;
  report_schedule_recipients?: Array<{
    id: string;
    email: string;
    recipient_name: string | null;
    partner_name: string | null;
    active: boolean;
  }>;
};

export type AdminReportingEntitlement = {
  id: string;
  user_id: string;
  account_id: string | null;
  location_id: string | null;
  machine_id: string | null;
  access_level: ReportingAccessLevel;
  grant_reason: string;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  reporting_machines?: { machine_label: string } | null;
  reporting_locations?: { name: string } | null;
  customer_accounts?: { name: string } | null;
};

export type AdminReportingOverview = {
  machines: AdminReportingMachine[];
  importRuns: AdminReportingImportRun[];
  schedules: AdminReportSchedule[];
  entitlements: AdminReportingEntitlement[];
};

type ReportingAccessContextRpc = {
  has_reporting_access: boolean | null;
  accessible_machine_count: number | null;
  accessible_location_count: number | null;
  can_manage_reporting: boolean | null;
  latest_sale_date: string | null;
  latest_import_completed_at: string | null;
};

type ReportingDimensionRpc = {
  account_id: string;
  account_name: string;
  location_id: string;
  location_name: string;
  machine_id: string;
  machine_label: string;
  machine_type: ReportingMachineType;
  sunze_machine_id: string | null;
  latest_sale_date: string | null;
  status: string;
};

type SalesReportRpcRow = {
  period_start: string;
  machine_id: string;
  machine_label: string;
  location_id: string;
  location_name: string;
  payment_method: PaymentMethod;
  net_sales_cents: number;
  refund_amount_cents: number;
  gross_sales_cents: number;
  transaction_count: number;
};

type ExportSalesReportResponse = {
  error?: string;
  snapshotId: string;
  storagePath: string;
  signedUrl: string;
  rowCount?: number;
};

type UpsertReportingMachineInput = {
  machineId?: string | null;
  accountName: string;
  locationName: string;
  machineLabel: string;
  machineType: ReportingMachineType;
  sunzeMachineId?: string | null;
  reason: string;
};

type GrantMachineReportAccessInput = {
  userEmail: string;
  accountId?: string | null;
  locationId?: string | null;
  machineId?: string | null;
  accessLevel: ReportingAccessLevel;
  reason: string;
};

type CreateReportScheduleInput = {
  title: string;
  filters: Record<string, unknown> & Partial<SalesReportFilters> & { title?: string };
  recipientEmails: string[];
  dayOfWeek: number;
  sendHourLocal: number;
  timezone: string;
};

export const emptyReportingAccessContext: ReportingAccessContext = {
  hasReportingAccess: false,
  accessibleMachineCount: 0,
  accessibleLocationCount: 0,
  canManageReporting: false,
  latestSaleDate: null,
  latestImportCompletedAt: null,
};

const mapAccessContext = (record: ReportingAccessContextRpc | null): ReportingAccessContext => {
  if (!record) {
    return emptyReportingAccessContext;
  }

  return {
    hasReportingAccess: Boolean(record.has_reporting_access),
    accessibleMachineCount: Number(record.accessible_machine_count ?? 0),
    accessibleLocationCount: Number(record.accessible_location_count ?? 0),
    canManageReporting: Boolean(record.can_manage_reporting),
    latestSaleDate: record.latest_sale_date,
    latestImportCompletedAt: record.latest_import_completed_at,
  };
};

const mapDimension = (record: ReportingDimensionRpc): ReportingDimension => ({
  accountId: record.account_id,
  accountName: record.account_name,
  locationId: record.location_id,
  locationName: record.location_name,
  machineId: record.machine_id,
  machineLabel: record.machine_label,
  machineType: record.machine_type,
  sunzeMachineId: record.sunze_machine_id,
  latestSaleDate: record.latest_sale_date,
  status: record.status,
});

const mapSalesReportRow = (record: SalesReportRpcRow): SalesReportRow => ({
  periodStart: record.period_start,
  machineId: record.machine_id,
  machineLabel: record.machine_label,
  locationId: record.location_id,
  locationName: record.location_name,
  paymentMethod: record.payment_method,
  netSalesCents: Number(record.net_sales_cents ?? 0),
  refundAmountCents: Number(record.refund_amount_cents ?? 0),
  grossSalesCents: Number(record.gross_sales_cents ?? 0),
  transactionCount: Number(record.transaction_count ?? 0),
});

export const summarizeSalesReport = (rows: SalesReportRow[]): SalesReportSummary =>
  rows.reduce<SalesReportSummary>(
    (summary, row) => ({
      netSalesCents: summary.netSalesCents + row.netSalesCents,
      refundAmountCents: summary.refundAmountCents + row.refundAmountCents,
      grossSalesCents: summary.grossSalesCents + row.grossSalesCents,
      transactionCount: summary.transactionCount + row.transactionCount,
    }),
    {
      netSalesCents: 0,
      refundAmountCents: 0,
      grossSalesCents: 0,
      transactionCount: 0,
    }
  );

export const fetchReportingAccessContext = async (): Promise<ReportingAccessContext> => {
  const { data, error } = await supabaseClient.rpc('get_my_reporting_access_context');

  if (error) {
    throw new Error(error.message || 'Unable to load reporting access.');
  }

  const record = Array.isArray(data)
    ? ((data as ReportingAccessContextRpc[])[0] ?? null)
    : ((data as ReportingAccessContextRpc | null) ?? null);

  return mapAccessContext(record);
};

export const fetchReportingDimensions = async (): Promise<ReportingDimension[]> => {
  const { data, error } = await supabaseClient.rpc('get_reporting_dimensions');

  if (error) {
    throw new Error(error.message || 'Unable to load reporting dimensions.');
  }

  return ((data as ReportingDimensionRpc[] | null) ?? []).map(mapDimension);
};

export const fetchSalesReport = async (filters: SalesReportFilters): Promise<SalesReportRow[]> => {
  const { data, error } = await supabaseClient.rpc('get_sales_report', {
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_grain: filters.grain,
    p_machine_ids: filters.machineIds?.length ? filters.machineIds : null,
    p_location_ids: filters.locationIds?.length ? filters.locationIds : null,
    p_payment_methods: filters.paymentMethods?.length ? filters.paymentMethods : null,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load sales report.');
  }

  return ((data as SalesReportRpcRow[] | null) ?? []).map(mapSalesReportRow);
};

export const exportSalesReportPdf = async (
  filters: SalesReportFilters & { title?: string }
): Promise<ExportSalesReportResponse> =>
  invokeEdgeFunction<ExportSalesReportResponse>(
    'sales-report-export',
    { filters },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to export sales reports.',
    }
  );

export const fetchAdminReportingOverview = async (): Promise<AdminReportingOverview> => {
  const [machinesResult, runsResult, schedulesResult, entitlementsResult] = await Promise.all([
    supabaseClient
      .from('reporting_machines')
      .select('*, reporting_locations(name, timezone), customer_accounts(name)')
      .order('updated_at', { ascending: false }),
    supabaseClient
      .from('sales_import_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseClient
      .from('report_schedules')
      .select('*, report_schedule_recipients(id, email, recipient_name, partner_name, active)')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseClient
      .from('reporting_machine_entitlements')
      .select('*, reporting_machines(machine_label), reporting_locations(name), customer_accounts(name)')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const firstError =
    machinesResult.error || runsResult.error || schedulesResult.error || entitlementsResult.error;

  if (firstError) {
    throw new Error(firstError.message || 'Unable to load reporting admin overview.');
  }

  return {
    machines: (machinesResult.data ?? []) as AdminReportingMachine[],
    importRuns: (runsResult.data ?? []) as AdminReportingImportRun[],
    schedules: (schedulesResult.data ?? []) as AdminReportSchedule[],
    entitlements: (entitlementsResult.data ?? []) as AdminReportingEntitlement[],
  };
};

export const upsertReportingMachineAdmin = async (
  input: UpsertReportingMachineInput
): Promise<AdminReportingMachine> => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_machine', {
    p_machine_id: input.machineId ?? null,
    p_account_name: input.accountName,
    p_location_name: input.locationName,
    p_machine_label: input.machineLabel,
    p_machine_type: input.machineType,
    p_sunze_machine_id: input.sunzeMachineId ?? null,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save reporting machine.');
  }

  return data as AdminReportingMachine;
};

export const grantMachineReportAccessAdmin = async (
  input: GrantMachineReportAccessInput
): Promise<AdminReportingEntitlement> => {
  const { data, error } = await supabaseClient.rpc('admin_grant_reporting_access', {
    p_user_email: input.userEmail,
    p_account_id: input.accountId ?? null,
    p_location_id: input.locationId ?? null,
    p_machine_id: input.machineId ?? null,
    p_access_level: input.accessLevel,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to grant report access.');
  }

  return data as AdminReportingEntitlement;
};

export const createReportScheduleAdmin = async (
  input: CreateReportScheduleInput
): Promise<AdminReportSchedule> => {
  const { data, error } = await supabaseClient.rpc('admin_create_report_schedule', {
    p_title: input.title,
    p_report_filters: input.filters,
    p_recipient_emails: input.recipientEmails,
    p_day_of_week: input.dayOfWeek,
    p_send_hour_local: input.sendHourLocal,
    p_timezone: input.timezone,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to create report schedule.');
  }

  return data as AdminReportSchedule;
};
