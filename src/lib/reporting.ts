import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import type { ReportingMachineType } from '@/lib/machineTypes';
import { supabaseClient } from '@/lib/supabaseClient';
import { getOptionalSnapCasePartnershipId } from '@/lib/snapcaseMappingWindow';

export type { ReportingMachineType } from '@/lib/machineTypes';

export type ReportGrain = 'day' | 'week' | 'month';
export type PaymentMethod = 'cash' | 'credit' | 'other' | 'unknown';
export type SalesReportCalculationVersion = 'legacy-sales-basis-v0' | 'shared-sales-basis-v1';
export type ReportingAccessLevel = 'viewer' | 'report_manager';
export type ReportingMachineOperationalPhase = 'setup' | 'live';

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
  calculationVersion: SalesReportCalculationVersion;
  periodStart: string;
  machineId: string;
  machineLabel: string;
  locationId: string;
  locationName: string;
  paymentMethod: PaymentMethod;
  netSalesCents: number | null;
  refundAmountCents: number | null;
  grossSalesCents: number | null;
  taxCents: number | null;
  refundRequestDeductionCents: number;
  refundReversalCents: number;
  refundLegacyPaidDeductionCents: number;
  refundPaidContextCents: number;
  refundOutstandingContextCents: number;
  unresolvedSalesCount: number;
  unresolvedSalesCents: number;
  unresolvedRefundCount: number;
  unresolvedRefundCents: number;
  unresolvedPaidContextCount: number;
  unresolvedPaidContextCents: number;
  transactionCount: number;
};

export type SalesReportSummary = {
  netSalesCents: number | null;
  refundAmountCents: number | null;
  grossSalesCents: number | null;
  taxCents: number | null;
  refundRequestDeductionCents: number;
  refundReversalCents: number;
  refundLegacyPaidDeductionCents: number;
  refundPaidContextCents: number;
  refundOutstandingContextCents: number;
  unresolvedSalesCount: number;
  unresolvedSalesCents: number;
  unresolvedRefundCount: number;
  unresolvedRefundCents: number;
  unresolvedPaidContextCount: number;
  unresolvedPaidContextCents: number;
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
  nayax_machine_id: string | null;
  status: string;
  operational_phase: ReportingMachineOperationalPhase;
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
  meta: Record<string, unknown>;
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

export type AdminReportViewSnapshot = {
  id: string;
  title: string;
  filters: Record<string, unknown>;
  summary: Record<string, unknown>;
  export_storage_path: string | null;
  exports: AdminReportExportArtifact[];
  export_status: 'pending' | 'ready' | 'failed';
  error_message: string | null;
  created_at: string;
  created_by: string | null;
  snapshot_type?: 'sales_report' | 'partner_report';
};

export type AdminReportExportFormat = 'pdf' | 'csv' | 'xlsx' | 'unknown';

export type AdminReportExportArtifact = {
  format: AdminReportExportFormat;
  storagePath: string;
  generatedAt: string | null;
  fileName: string | null;
  label: string;
  description: string;
  isPrimary: boolean;
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

export type AdminRefundAdjustmentReviewRow = {
  id: string;
  source_reference: string;
  source_row_reference: string;
  source_reporting_machine_id: string | null;
  source_location: string | null;
  refund_date: string | null;
  amount_cents: number;
  source_status: string | null;
  match_status: string;
  match_confidence: number;
  match_reason: string | null;
  candidate_machine_ids: string[];
  matched_machine_id: string | null;
  resolution_status: string;
  applied_adjustment_id: string | null;
  imported_at: string;
  reporting_machines?: { machine_label: string } | null;
};

export type AdminReportingOverview = {
  machines: AdminReportingMachine[];
  partnerships: AdminReportingPartnershipOption[];
  importRuns: AdminReportingImportRun[];
  schedules: AdminReportSchedule[];
  snapshots: AdminReportViewSnapshot[];
  entitlements: AdminReportingEntitlement[];
  sunzeMachineQueue: AdminSunzeMachineQueueItem[];
  snapcaseMachineQueue: AdminSnapCaseMachineQueueItem[];
  refundReviewRows: AdminRefundAdjustmentReviewRow[];
};

export type AdminSnapCaseMachineQueueItem = {
  providerAccountId: string;
  sourceAccountKey: string;
  sourceMachineId: string;
  sourceInventoryId: string | null;
  sourceMerchantId: string | null;
  sourceMerchantName: string | null;
  sourceLabel: string | null;
  sourceStatus: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  stagedObservationCount: number;
  mappingStatus: 'pending' | 'mapped';
  reportingMachineId: string | null;
  partnershipId: string | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
};

export type AdminSunzeMachineQueueItem = {
  sunzeMachineId: string;
  sunzeMachineName: string | null;
  status: 'pending' | 'ignored';
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  ignoredAt: string | null;
  ignoreReason: string | null;
  pendingRowCount: number;
  pendingRevenueCents: number;
  latestSaleDate: string | null;
};

export type AdminReportingPartnershipOption = {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  effective_start_date: string;
  effective_end_date: string | null;
};

export type AdminReportingAccessPerson = {
  userId: string;
  userEmail: string | null;
  isSuperAdmin: boolean;
  explicitMachineCount: number;
  inheritedGrantCount: number;
};

export type AdminReportingAccessMachine = {
  id: string;
  accountId: string;
  accountName: string;
  locationId: string;
  locationName: string;
  machineLabel: string;
  machineType: ReportingMachineType;
  sunzeMachineId: string | null;
  status: string;
  latestSaleDate: string | null;
  viewerCount: number;
  viewers: Array<{
    userId: string;
    userEmail: string | null;
  }>;
};

export type AdminReportingAccessGrant = {
  id: string;
  userId: string;
  userEmail: string | null;
  accountId: string | null;
  locationId: string | null;
  machineId: string | null;
  accessLevel: ReportingAccessLevel;
  grantReason: string;
  startsAt: string;
  expiresAt: string | null;
  createdAt: string;
  scopeType: 'account' | 'location' | 'machine' | 'unknown';
};

export type AdminReportingAccessMatrix = {
  people: AdminReportingAccessPerson[];
  machines: AdminReportingAccessMachine[];
  grants: AdminReportingAccessGrant[];
};

type AdminReportingAccessMatrixRpc = {
  people?: Array<{
    userId?: string;
    userEmail?: string | null;
    isSuperAdmin?: boolean;
    explicitMachineCount?: number;
    inheritedGrantCount?: number;
  }>;
  machines?: Array<{
    id?: string;
    accountId?: string;
    accountName?: string;
    locationId?: string;
    locationName?: string;
    machineLabel?: string;
    machineType?: ReportingMachineType;
    sunzeMachineId?: string | null;
    status?: string;
    latestSaleDate?: string | null;
    viewerCount?: number;
    viewers?: Array<{
      userId?: string;
      userEmail?: string | null;
    }>;
  }>;
  grants?: Array<{
    id?: string;
    userId?: string;
    userEmail?: string | null;
    accountId?: string | null;
    locationId?: string | null;
    machineId?: string | null;
    accessLevel?: ReportingAccessLevel;
    grantReason?: string;
    startsAt?: string;
    expiresAt?: string | null;
    createdAt?: string;
    scopeType?: AdminReportingAccessGrant['scopeType'];
  }>;
};

type AdminReportingUserLookupRpc = {
  user_id: string;
  user_email: string | null;
  is_super_admin: boolean | null;
  explicit_machine_count: number | null;
  inherited_grant_count: number | null;
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
  calculation_version?: string | null;
  period_start: string;
  machine_id: string;
  machine_label: string;
  location_id: string;
  location_name: string;
  payment_method: PaymentMethod;
  net_sales_cents: number | null;
  refund_amount_cents: number | null;
  gross_sales_cents: number | null;
  tax_cents: number | null;
  refund_request_deduction_cents: number;
  refund_reversal_cents: number;
  refund_legacy_paid_deduction_cents: number;
  refund_paid_context_cents: number;
  refund_outstanding_context_cents: number;
  unresolved_sales_count: number;
  unresolved_sales_cents: number;
  unresolved_refund_count: number;
  unresolved_refund_cents: number;
  unresolved_paid_context_count: number;
  unresolved_paid_context_cents: number;
  transaction_count: number;
};

type ExportSalesReportResponse = {
  error?: string;
  snapshotId: string;
  storagePath: string;
  signedUrl: string;
  pdfGeneratorVersion?: string;
  rowCount?: number;
};

const supportedSalesReportPdfGeneratorVersions = new Set([
  'sales-report-pdf/polished-v1',
  'sales-report-pdf/shared-basis-v2',
]);
const reportExportBucket = 'sales-report-exports';

const exportFormatOrder: Record<AdminReportExportFormat, number> = {
  pdf: 0,
  csv: 1,
  xlsx: 2,
  unknown: 3,
};

const exportFormatLabels: Record<AdminReportExportFormat, { label: string; description: string }> = {
  pdf: {
    label: 'PDF',
    description: 'Primary partner-facing report',
  },
  csv: {
    label: 'CSV',
    description: 'Finance/reconciliation data export',
  },
  xlsx: {
    label: 'XLSX',
    description: 'Spreadsheet workbook export',
  },
  unknown: {
    label: 'File',
    description: 'Report export artifact',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const getFileNameFromStoragePath = (storagePath: string) => {
  const [pathWithoutQuery] = storagePath.split('?');
  const segments = pathWithoutQuery.split('/').filter(Boolean);
  return segments.at(-1) ?? storagePath;
};

const normalizeReportExportFormat = (
  format: unknown,
  storagePath?: string | null,
  fileName?: string | null
): AdminReportExportFormat => {
  const candidate = `${asTrimmedString(format) ?? ''} ${fileName ?? ''} ${storagePath ?? ''}`.toLowerCase();

  if (candidate.includes('pdf')) return 'pdf';
  if (candidate.includes('csv')) return 'csv';
  if (candidate.includes('xlsx')) return 'xlsx';
  return 'unknown';
};

const buildAdminReportExportArtifact = ({
  format,
  storagePath,
  generatedAt,
  fileName,
}: {
  format: unknown;
  storagePath: string;
  generatedAt?: unknown;
  fileName?: unknown;
}): AdminReportExportArtifact => {
  const normalizedFileName = asTrimmedString(fileName) ?? getFileNameFromStoragePath(storagePath);
  const normalizedFormat = normalizeReportExportFormat(format, storagePath, normalizedFileName);
  const meta = exportFormatLabels[normalizedFormat];

  return {
    format: normalizedFormat,
    storagePath,
    generatedAt: asTrimmedString(generatedAt),
    fileName: normalizedFileName,
    label: meta.label,
    description: meta.description,
    isPrimary: normalizedFormat === 'pdf',
  };
};

export const mapAdminReportExportArtifacts = ({
  summary,
  fallbackStoragePath,
  fallbackGeneratedAt,
}: {
  summary: Record<string, unknown> | null | undefined;
  fallbackStoragePath?: string | null;
  fallbackGeneratedAt?: string | null;
}): AdminReportExportArtifact[] => {
  const exportsRecord = isRecord(summary?.exports) ? summary.exports : null;
  const seenPaths = new Set<string>();
  const artifacts: AdminReportExportArtifact[] = [];

  if (exportsRecord) {
    Object.entries(exportsRecord).forEach(([format, value]) => {
      if (!isRecord(value)) return;

      const storagePath = asTrimmedString(value.storagePath);
      if (!storagePath || seenPaths.has(storagePath)) return;

      seenPaths.add(storagePath);
      artifacts.push(
        buildAdminReportExportArtifact({
          format,
          storagePath,
          generatedAt: value.generatedAt,
          fileName: value.fileName,
        })
      );
    });
  }

  const fallbackPath = asTrimmedString(fallbackStoragePath);
  if (artifacts.length === 0 && fallbackPath) {
    artifacts.push(
      buildAdminReportExportArtifact({
        format: null,
        storagePath: fallbackPath,
        generatedAt: fallbackGeneratedAt,
      })
    );
  }

  return artifacts.sort((left, right) => {
    const formatCompare = exportFormatOrder[left.format] - exportFormatOrder[right.format];
    if (formatCompare !== 0) return formatCompare;
    return (right.generatedAt ?? '').localeCompare(left.generatedAt ?? '');
  });
};

export const createReportExportSignedUrl = async (storagePath: string): Promise<string> => {
  const path = storagePath.trim();
  if (!path) throw new Error('Report export path is missing.');

  const { data, error } = await supabaseClient.storage
    .from(reportExportBucket)
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to create report export download link.');
  }

  return data.signedUrl;
};

type UpsertReportingMachineInput = {
  machineId?: string | null;
  accountId: string;
  locationId: string | null;
  expectedAccountId?: string | null;
  expectedLocationId?: string | null;
  newLocationName?: string | null;
  newLocationTimezone?: string | null;
  machineLabel: string;
  machineType: ReportingMachineType;
  sunzeMachineId?: string | null;
  operationalPhase: ReportingMachineOperationalPhase;
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

type RevokeReportingAccessInput = {
  entitlementId: string;
  reason: string;
};

type SetSunzeMachineDiscoveryStatusInput = {
  sunzeMachineId: string;
  status: 'pending' | 'ignored';
  reason: string;
};

type MapSourceMachineToPartnershipInput = {
  externalMachineId: string;
  partnershipId: string;
  machineLabel: string;
  accountId: string;
  locationId?: string | null;
  locationName?: string | null;
  locationTimezone?: string | null;
  expectedAccountId?: string | null;
  expectedLocationId?: string | null;
  machineType: ReportingMachineType;
  taxRatePercent: number;
  assignmentStartDate: string;
  assignmentEndDate?: string | null;
  taxEffectiveStartDate: string;
  reason: string;
};

type MapSnapCaseMachineInput = {
  providerAccountId: string;
  sourceMachineId: string;
  reportingMachineId?: string | null;
  accountId?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  locationTimezone?: string | null;
  machineLabel?: string | null;
  partnershipId?: string | null;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  reason: string;
};

export type MapSnapCaseMachineResult = {
  machineId: string;
  machineLabel: string;
  partnershipId: string;
  partnershipName: string;
  providerAccountId: string;
  sourceMachineId: string;
  createdMachine: boolean;
  replayed: boolean;
  publishedObservationCount: number;
};

export type MapSourceMachineToPartnershipResult = {
  machineId: string;
  machineLabel: string;
  externalMachineId: string;
  accountName: string;
  locationName: string;
  partnershipId: string;
  partnershipName: string;
  assignmentId: string;
  taxRateId: string;
  promotedRowCount: number;
  promotedRevenueCents: number;
};

type SetUserMachineReportingAccessInput = {
  userEmail: string;
  machineIds: string[];
  accessLevel: ReportingAccessLevel;
  reason: string;
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

const normalizeSalesReportCalculationVersion = (
  value: string | null | undefined
): SalesReportCalculationVersion =>
  value === 'shared-sales-basis-v1' ? 'shared-sales-basis-v1' : 'legacy-sales-basis-v0';

const mapSalesReportRow = (record: SalesReportRpcRow): SalesReportRow => ({
  calculationVersion: normalizeSalesReportCalculationVersion(record.calculation_version),
  periodStart: record.period_start,
  machineId: record.machine_id,
  machineLabel: record.machine_label,
  locationId: record.location_id,
  locationName: record.location_name,
  paymentMethod: record.payment_method,
  netSalesCents: record.net_sales_cents == null ? null : Number(record.net_sales_cents),
  refundAmountCents: record.refund_amount_cents == null ? null : Number(record.refund_amount_cents),
  grossSalesCents: record.gross_sales_cents == null ? null : Number(record.gross_sales_cents),
  taxCents: record.tax_cents == null ? null : Number(record.tax_cents),
  refundRequestDeductionCents: Number(record.refund_request_deduction_cents ?? 0),
  refundReversalCents: Number(record.refund_reversal_cents ?? 0),
  refundLegacyPaidDeductionCents: Number(record.refund_legacy_paid_deduction_cents ?? 0),
  refundPaidContextCents: Number(record.refund_paid_context_cents ?? 0),
  refundOutstandingContextCents: Number(record.refund_outstanding_context_cents ?? 0),
  unresolvedSalesCount: Number(record.unresolved_sales_count ?? 0),
  unresolvedSalesCents: Number(record.unresolved_sales_cents ?? 0),
  unresolvedRefundCount: Number(record.unresolved_refund_count ?? 0),
  unresolvedRefundCents: Number(record.unresolved_refund_cents ?? 0),
  unresolvedPaidContextCount: Number(record.unresolved_paid_context_count ?? 0),
  unresolvedPaidContextCents: Number(record.unresolved_paid_context_cents ?? 0),
  transactionCount: Number(record.transaction_count ?? 0),
});

const mapSunzeMachineQueue = (records: unknown): AdminSunzeMachineQueueItem[] =>
  (Array.isArray(records) ? records : [])
    .filter((record): record is Record<string, unknown> => typeof record === 'object' && record !== null)
    .map((record) => ({
      sunzeMachineId: String(record.sunzeMachineId ?? ''),
      sunzeMachineName:
        typeof record.sunzeMachineName === 'string' && record.sunzeMachineName.trim()
          ? record.sunzeMachineName
          : null,
      status: record.status === 'ignored' ? 'ignored' : 'pending',
      firstSeenAt: typeof record.firstSeenAt === 'string' ? record.firstSeenAt : null,
      lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : null,
      ignoredAt: typeof record.ignoredAt === 'string' ? record.ignoredAt : null,
      ignoreReason: typeof record.ignoreReason === 'string' ? record.ignoreReason : null,
      pendingRowCount: Number(record.pendingRowCount ?? 0),
      pendingRevenueCents: Number(record.pendingRevenueCents ?? 0),
      latestSaleDate: typeof record.latestSaleDate === 'string' ? record.latestSaleDate : null,
    }))
    .filter((record) => record.sunzeMachineId);

const mapSnapCaseMachineQueue = (records: unknown): AdminSnapCaseMachineQueueItem[] =>
  (Array.isArray(records) ? records : [])
    .filter((record): record is Record<string, unknown> => typeof record === 'object' && record !== null)
    .map((record) => ({
      providerAccountId: String(record.providerAccountId ?? ''),
      sourceAccountKey: String(record.sourceAccountKey ?? ''),
      sourceMachineId: String(record.sourceMachineId ?? ''),
      sourceInventoryId: asTrimmedString(record.sourceInventoryId),
      sourceMerchantId: asTrimmedString(record.sourceMerchantId),
      sourceMerchantName: asTrimmedString(record.sourceMerchantName),
      sourceLabel: asTrimmedString(record.sourceLabel),
      sourceStatus: asTrimmedString(record.sourceStatus),
      firstSeenAt: asTrimmedString(record.firstSeenAt),
      lastSeenAt: asTrimmedString(record.lastSeenAt),
      stagedObservationCount: Number(record.stagedObservationCount ?? 0),
      mappingStatus: record.mappingStatus === 'mapped' ? 'mapped' : 'pending',
      reportingMachineId: asTrimmedString(record.reportingMachineId),
      partnershipId: asTrimmedString(record.partnershipId),
      effectiveStartDate: asTrimmedString(record.effectiveStartDate),
      effectiveEndDate: asTrimmedString(record.effectiveEndDate),
    }))
    .filter((record) => record.providerAccountId && record.sourceMachineId);

export const summarizeSalesReport = (rows: SalesReportRow[]): SalesReportSummary => {
  const summary = rows.reduce<SalesReportSummary>(
    (summary, row) => ({
      netSalesCents: (summary.netSalesCents ?? 0) + (row.netSalesCents ?? 0),
      refundAmountCents: (summary.refundAmountCents ?? 0) + (row.refundAmountCents ?? 0),
      grossSalesCents: (summary.grossSalesCents ?? 0) + (row.grossSalesCents ?? 0),
      taxCents: (summary.taxCents ?? 0) + (row.taxCents ?? 0),
      refundRequestDeductionCents:
        summary.refundRequestDeductionCents + row.refundRequestDeductionCents,
      refundReversalCents: summary.refundReversalCents + row.refundReversalCents,
      refundLegacyPaidDeductionCents:
        summary.refundLegacyPaidDeductionCents + row.refundLegacyPaidDeductionCents,
      refundPaidContextCents: summary.refundPaidContextCents + row.refundPaidContextCents,
      refundOutstandingContextCents:
        summary.refundOutstandingContextCents + row.refundOutstandingContextCents,
      unresolvedSalesCount: summary.unresolvedSalesCount + row.unresolvedSalesCount,
      unresolvedSalesCents: summary.unresolvedSalesCents + row.unresolvedSalesCents,
      unresolvedRefundCount: summary.unresolvedRefundCount + row.unresolvedRefundCount,
      unresolvedRefundCents: summary.unresolvedRefundCents + row.unresolvedRefundCents,
      unresolvedPaidContextCount:
        summary.unresolvedPaidContextCount + row.unresolvedPaidContextCount,
      unresolvedPaidContextCents:
        summary.unresolvedPaidContextCents + row.unresolvedPaidContextCents,
      transactionCount: summary.transactionCount + row.transactionCount,
    }),
    {
      netSalesCents: 0,
      refundAmountCents: 0,
      grossSalesCents: 0,
      taxCents: 0,
      refundRequestDeductionCents: 0,
      refundReversalCents: 0,
      refundLegacyPaidDeductionCents: 0,
      refundPaidContextCents: 0,
      refundOutstandingContextCents: 0,
      unresolvedSalesCount: 0,
      unresolvedSalesCents: 0,
      unresolvedRefundCount: 0,
      unresolvedRefundCents: 0,
      unresolvedPaidContextCount: 0,
      unresolvedPaidContextCents: 0,
      transactionCount: 0,
    }
  );

  return {
    ...summary,
    netSalesCents: rows.some((row) => row.netSalesCents == null)
      ? null : summary.netSalesCents,
    refundAmountCents: rows.some((row) => row.refundAmountCents == null)
      ? null : summary.refundAmountCents,
    grossSalesCents: rows.some((row) => row.grossSalesCents == null)
      ? null : summary.grossSalesCents,
    taxCents: rows.some((row) => row.taxCents == null)
      ? null : summary.taxCents,
  };
};

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

  const rows = (data as SalesReportRpcRow[] | null) ?? [];
  const versions = new Set(rows.map((row) => normalizeSalesReportCalculationVersion(row.calculation_version)));
  const hasUnsupportedVersion = rows.some((row) =>
    row.calculation_version != null &&
    row.calculation_version !== 'legacy-sales-basis-v0' &&
    row.calculation_version !== 'shared-sales-basis-v1'
  );
  if (hasUnsupportedVersion || versions.size > 1) {
    throw new Error('Sales report rows use inconsistent calculation versions. Refresh the report and try again.');
  }

  return rows.map(mapSalesReportRow);
};

export const exportSalesReportPdf = async (
  filters: SalesReportFilters & { title?: string }
): Promise<ExportSalesReportResponse> => {
  const response = await invokeEdgeFunction<ExportSalesReportResponse>(
    'sales-report-export',
    { filters },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to export sales reports.',
    }
  );

  if (!supportedSalesReportPdfGeneratorVersions.has(response.pdfGeneratorVersion ?? '')) {
    throw new Error(
      'Operator report export is running an outdated PDF generator. Redeploy the sales-report-export Edge Function before sharing this report.'
    );
  }

  return response;
};

export const fetchAdminReportingOverview = async (): Promise<AdminReportingOverview> => {
  const [
    machinesResult,
    partnershipsResult,
    runsResult,
    schedulesResult,
    snapshotsResult,
    partnerSnapshotsResult,
    entitlementsResult,
    sunzeQueueResult,
    snapcaseQueueResult,
    refundReviewResult,
  ] = await Promise.all([
    supabaseClient
      .from('reporting_machines')
      .select('*, reporting_locations(name, timezone), customer_accounts(name)')
      .order('updated_at', { ascending: false }),
    supabaseClient
      .from('reporting_partnerships')
      .select('id, name, status, effective_start_date, effective_end_date')
      .in('status', ['active', 'draft'])
      .order('status', { ascending: true })
      .order('name', { ascending: true }),
    supabaseClient
      .from('sales_import_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseClient
      .from('report_schedules')
      .select('*, report_schedule_recipients(id, email, recipient_name, partner_name, active)')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseClient
      .from('report_view_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseClient
      .from('partner_report_snapshots')
      .select('id, partnership_id, week_ending_date, period_grain, period_start_date, period_end_date, status, generated_at, generated_by, summary_json, export_storage_path, reporting_partnerships(name)')
      .order('generated_at', { ascending: false })
      .limit(10),
    supabaseClient
      .from('reporting_machine_entitlements')
      .select('*, reporting_machines(machine_label), reporting_locations(name), customer_accounts(name)')
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseClient.rpc('admin_get_sunze_machine_mapping_queue'),
    supabaseClient.rpc('admin_get_snapcase_machine_mapping_queue'),
    supabaseClient
      .from('refund_adjustment_review_rows')
      .select('id, source_reference, source_row_reference, source_reporting_machine_id, source_location, refund_date, amount_cents, source_status, match_status, match_confidence, match_reason, candidate_machine_ids, matched_machine_id, resolution_status, applied_adjustment_id, imported_at, reporting_machines(machine_label)')
      .order('imported_at', { ascending: false })
      .limit(20),
  ]);

  const firstError =
    machinesResult.error ||
    partnershipsResult.error ||
    runsResult.error ||
    schedulesResult.error ||
    snapshotsResult.error ||
    partnerSnapshotsResult.error ||
    entitlementsResult.error ||
    sunzeQueueResult.error ||
    snapcaseQueueResult.error ||
    refundReviewResult.error;

  if (firstError) {
    throw new Error(firstError.message || 'Unable to load reporting admin overview.');
  }

  const salesSnapshots = ((snapshotsResult.data ?? []) as AdminReportViewSnapshot[]).map((snapshot) => ({
    ...snapshot,
    exports: mapAdminReportExportArtifacts({
      summary: snapshot.summary,
      fallbackStoragePath: snapshot.export_storage_path,
      fallbackGeneratedAt: snapshot.created_at,
    }),
    snapshot_type: 'sales_report' as const,
  }));
  const partnerSnapshots = ((partnerSnapshotsResult.data ?? []) as Array<{
    id: string;
    partnership_id: string;
    week_ending_date: string;
    period_grain?: 'reporting_week' | 'calendar_month' | null;
    period_start_date?: string | null;
    period_end_date?: string | null;
    status: string;
    generated_at: string;
    generated_by: string | null;
    summary_json: Record<string, unknown> | null;
    export_storage_path: string | null;
    reporting_partnerships?: { name?: string | null } | Array<{ name?: string | null }> | null;
  }>).map((snapshot) => {
    const partnership = Array.isArray(snapshot.reporting_partnerships)
      ? snapshot.reporting_partnerships[0]
      : snapshot.reporting_partnerships;
    const periodGrain = snapshot.period_grain ?? 'reporting_week';
    const periodStartDate = snapshot.period_start_date ?? snapshot.week_ending_date;
    const periodEndDate = snapshot.period_end_date ?? snapshot.week_ending_date;
    const periodLabel =
      periodGrain === 'calendar_month'
        ? `month ending ${periodEndDate}`
        : `week ending ${periodEndDate}`;
    const title = `${partnership?.name ?? 'Partner report'} ${periodLabel}`;

    const summary = snapshot.summary_json ?? {};
    const exports = mapAdminReportExportArtifacts({
      summary,
      fallbackStoragePath: snapshot.export_storage_path,
      fallbackGeneratedAt: snapshot.generated_at,
    });

    return {
      id: snapshot.id,
      title,
      filters: {
        partnershipId: snapshot.partnership_id,
        weekEndingDate: snapshot.week_ending_date,
        periodGrain,
        periodStartDate,
        periodEndDate,
      },
      summary,
      export_storage_path: snapshot.export_storage_path,
      exports,
      export_status: exports.length > 0 ? 'ready' : 'pending',
      error_message: null,
      created_at: snapshot.generated_at,
      created_by: snapshot.generated_by,
      snapshot_type: 'partner_report' as const,
    } satisfies AdminReportViewSnapshot;
  });
  const snapshots = [...salesSnapshots, ...partnerSnapshots]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 10);

  return {
    machines: (machinesResult.data ?? []) as AdminReportingMachine[],
    partnerships: (partnershipsResult.data ?? []) as AdminReportingPartnershipOption[],
    importRuns: (runsResult.data ?? []) as AdminReportingImportRun[],
    schedules: (schedulesResult.data ?? []) as AdminReportSchedule[],
    snapshots,
    entitlements: (entitlementsResult.data ?? []) as AdminReportingEntitlement[],
    sunzeMachineQueue: mapSunzeMachineQueue(sunzeQueueResult.data),
    snapcaseMachineQueue: mapSnapCaseMachineQueue(snapcaseQueueResult.data),
    refundReviewRows: (refundReviewResult.data ?? []) as AdminRefundAdjustmentReviewRow[],
  };
};

export const mapSnapCaseMachineAdmin = async (
  input: MapSnapCaseMachineInput
): Promise<MapSnapCaseMachineResult> => {
  const { data, error } = await supabaseClient.rpc('admin_map_snapcase_machine', {
    p_provider_account_id: input.providerAccountId,
    p_source_machine_id: input.sourceMachineId,
    p_reporting_machine_id: input.reportingMachineId || null,
    p_account_id: input.accountId || null,
    p_location_id: input.locationId || null,
    p_location_name: input.locationName || null,
    p_location_timezone: input.locationTimezone || null,
    p_machine_label: input.machineLabel || null,
    p_partnership_id: getOptionalSnapCasePartnershipId(input.partnershipId),
    p_effective_start_date: input.effectiveStartDate,
    p_effective_end_date: input.effectiveEndDate || null,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to map SnapCase machine.');
  }

  const record = data as Partial<MapSnapCaseMachineResult>;
  return {
    machineId: String(record.machineId ?? ''),
    machineLabel: String(record.machineLabel ?? ''),
    partnershipId: String(record.partnershipId ?? input.partnershipId ?? ''),
    partnershipName: String(record.partnershipName ?? ''),
    providerAccountId: String(record.providerAccountId ?? input.providerAccountId),
    sourceMachineId: String(record.sourceMachineId ?? input.sourceMachineId),
    createdMachine: Boolean(record.createdMachine),
    replayed: Boolean(record.replayed),
    publishedObservationCount: Number(record.publishedObservationCount ?? 0),
  };
};

export const mapSourceMachineToPartnershipAdmin = async (
  input: MapSourceMachineToPartnershipInput
): Promise<MapSourceMachineToPartnershipResult> => {
  const { data, error } = await supabaseClient.rpc('admin_map_source_machine_to_partnership_by_id', {
    p_external_machine_id: input.externalMachineId,
    p_partnership_id: input.partnershipId,
    p_machine_label: input.machineLabel,
    p_account_id: input.accountId,
    p_location_id: input.locationId ?? null,
    p_location_name: input.locationName ?? null,
    p_location_timezone: input.locationTimezone ?? null,
    p_expected_account_id: input.expectedAccountId ?? null,
    p_expected_location_id: input.expectedLocationId ?? null,
    p_machine_type: input.machineType,
    p_tax_rate_percent: input.taxRatePercent,
    p_assignment_start_date: input.assignmentStartDate,
    p_assignment_end_date: input.assignmentEndDate || null,
    p_tax_effective_start_date: input.taxEffectiveStartDate,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to set up imported machine.');
  }

  const record = data as Partial<MapSourceMachineToPartnershipResult>;
  return {
    machineId: String(record.machineId ?? ''),
    machineLabel: String(record.machineLabel ?? ''),
    externalMachineId: String(record.externalMachineId ?? input.externalMachineId),
    accountName: String(record.accountName ?? ''),
    locationName: String(record.locationName ?? ''),
    partnershipId: String(record.partnershipId ?? input.partnershipId),
    partnershipName: String(record.partnershipName ?? ''),
    assignmentId: String(record.assignmentId ?? ''),
    taxRateId: String(record.taxRateId ?? ''),
    promotedRowCount: Number(record.promotedRowCount ?? 0),
    promotedRevenueCents: Number(record.promotedRevenueCents ?? 0),
  };
};

const mapAccessMatrix = (
  record: AdminReportingAccessMatrixRpc | null
): AdminReportingAccessMatrix => ({
  people: (record?.people ?? [])
    .filter((person) => person.userId)
    .map((person) => ({
      userId: person.userId as string,
      userEmail: person.userEmail ?? null,
      isSuperAdmin: Boolean(person.isSuperAdmin),
      explicitMachineCount: Number(person.explicitMachineCount ?? 0),
      inheritedGrantCount: Number(person.inheritedGrantCount ?? 0),
    })),
  machines: (record?.machines ?? [])
    .filter((machine) => machine.id)
    .map((machine) => ({
      id: machine.id as string,
      accountId: machine.accountId ?? '',
      accountName: machine.accountName ?? 'Unassigned account',
      locationId: machine.locationId ?? '',
      locationName: machine.locationName ?? 'Unassigned location',
      machineLabel: machine.machineLabel ?? 'Unnamed machine',
      machineType: machine.machineType ?? 'unknown',
      sunzeMachineId: machine.sunzeMachineId ?? null,
      status: machine.status ?? 'active',
      latestSaleDate: machine.latestSaleDate ?? null,
      viewerCount: Number(machine.viewerCount ?? 0),
      viewers: (machine.viewers ?? [])
        .filter((viewer) => viewer.userId)
        .map((viewer) => ({
          userId: viewer.userId as string,
          userEmail: viewer.userEmail ?? null,
        })),
    })),
  grants: (record?.grants ?? [])
    .filter((grant) => grant.id && grant.userId)
    .map((grant) => ({
      id: grant.id as string,
      userId: grant.userId as string,
      userEmail: grant.userEmail ?? null,
      accountId: grant.accountId ?? null,
      locationId: grant.locationId ?? null,
      machineId: grant.machineId ?? null,
      accessLevel: grant.accessLevel ?? 'viewer',
      grantReason: grant.grantReason ?? 'Sales reporting access',
      startsAt: grant.startsAt ?? '',
      expiresAt: grant.expiresAt ?? null,
      createdAt: grant.createdAt ?? '',
      scopeType: grant.scopeType ?? 'unknown',
    })),
});

export const fetchAdminReportingAccessMatrix = async (): Promise<AdminReportingAccessMatrix> => {
  const { data, error } = await supabaseClient.rpc('admin_get_reporting_access_matrix');

  if (error) {
    throw new Error(error.message || 'Unable to load reporting access matrix.');
  }

  return mapAccessMatrix((data as AdminReportingAccessMatrixRpc | null) ?? null);
};

export const lookupReportingUserByEmailAdmin = async (
  userEmail: string
): Promise<AdminReportingAccessPerson> => {
  const { data, error } = await supabaseClient.rpc('admin_lookup_reporting_user_by_email', {
    p_user_email: userEmail.trim(),
  });

  if (error) {
    throw new Error(error.message || 'Unable to find reporting user.');
  }

  const record = Array.isArray(data)
    ? ((data as AdminReportingUserLookupRpc[])[0] ?? null)
    : ((data as AdminReportingUserLookupRpc | null) ?? null);

  if (!record?.user_id) {
    throw new Error(`No user found for ${userEmail.trim()}.`);
  }

  return {
    userId: record.user_id,
    userEmail: record.user_email,
    isSuperAdmin: Boolean(record.is_super_admin),
    explicitMachineCount: Number(record.explicit_machine_count ?? 0),
    inheritedGrantCount: Number(record.inherited_grant_count ?? 0),
  };
};

export const upsertReportingMachineAdmin = async (
  input: UpsertReportingMachineInput
): Promise<AdminReportingMachine> => {
  const { data, error } = await supabaseClient.rpc('admin_upsert_reporting_machine_by_id', {
    p_machine_id: input.machineId ?? null,
    p_account_id: input.accountId,
    p_location_id: input.locationId,
    p_expected_account_id: input.expectedAccountId ?? null,
    p_expected_location_id: input.expectedLocationId ?? null,
    p_new_location_name: input.newLocationName ?? null,
    p_new_location_timezone: input.newLocationTimezone ?? null,
    p_machine_label: input.machineLabel,
    p_machine_type: input.machineType,
    p_sunze_machine_id: input.sunzeMachineId ?? null,
    p_operational_phase: input.operationalPhase,
    p_reason: input.reason,
  });

  if (error || !data) {
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      throw new Error('Machine lifecycle setup will be available after the database rollout completes.');
    }
    throw new Error(error?.message || 'Unable to save reporting machine.');
  }

  return data as AdminReportingMachine;
};

export const setSunzeMachineDiscoveryStatusAdmin = async (
  input: SetSunzeMachineDiscoveryStatusInput
): Promise<void> => {
  const { error } = await supabaseClient.rpc('admin_set_sunze_machine_discovery_status', {
    p_sunze_machine_id: input.sunzeMachineId,
    p_status: input.status,
    p_reason: input.reason,
  });

  if (error) {
    throw new Error(error.message || 'Unable to update source machine queue.');
  }
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

export const revokeReportingAccessAdmin = async (
  input: RevokeReportingAccessInput
): Promise<AdminReportingEntitlement> => {
  const { data, error } = await supabaseClient.rpc('admin_revoke_reporting_access', {
    p_entitlement_id: input.entitlementId,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to revoke report access.');
  }

  return data as AdminReportingEntitlement;
};

export const setUserMachineReportingAccessAdmin = async (
  input: SetUserMachineReportingAccessInput
): Promise<{
  userId: string;
  machineCount: number;
  addedCount: number;
  revokedCount: number;
}> => {
  const { data, error } = await supabaseClient.rpc('admin_set_user_machine_reporting_access', {
    p_user_email: input.userEmail,
    p_machine_ids: input.machineIds,
    p_access_level: input.accessLevel,
    p_reason: input.reason,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save report access.');
  }

  return data as {
    userId: string;
    machineCount: number;
    addedCount: number;
    revokedCount: number;
  };
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
