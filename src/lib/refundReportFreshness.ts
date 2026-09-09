type RefundReportFreshnessV1 = {
  status: 'unobserved' | 'recent' | 'needs_review';
  lastReceivedAt: string | null;
  reviewAfter: string | null;
  configuredCadenceMinutes: 60;
  reviewGraceMinutes: 120;
};

export type RefundReportFreshness = RefundReportFreshnessV1 & {
  schemaVersion?: 'refund_report_health_v2';
  deliveryState?: 'unobserved' | 'file_received' | 'explicit_empty' | 'provider_failed' | 'file_sent_awaiting_ingest' | 'ordinary_silence';
  ingestState?: 'unknown' | 'healthy' | 'failed';
  coverageState?: 'unknown' | 'declared_period';
  coverageReason?: 'provider_reporting_period_not_supplied' | null;
  attentionRequired?: boolean;
  attentionReason?: 'report_ingest_failed' | 'provider_run_failed' | 'provider_file_not_ingested' | null;
  affectedCaseCount?: number;
  lastProviderRunAt?: string | null;
  lastRecordedAt?: string | null;
  absenceIsNoRefundEvidence?: false;
  paymentRetryAuthorized?: false;
};

export const parseRefundReportFreshness = (value: unknown): RefundReportFreshness | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!['unobserved', 'recent', 'needs_review'].includes(String(row.status)) ||
    row.configuredCadenceMinutes !== 60 || row.reviewGraceMinutes !== 120) return null;
  const date = (candidate: unknown) => typeof candidate === 'string' && Number.isFinite(Date.parse(candidate)) ? candidate : null;
  const lastReceivedAt = date(row.lastReceivedAt);
  const reviewAfter = date(row.reviewAfter);
  const isV2 = row.schemaVersion === 'refund_report_health_v2';
  if (!isV2 && row.status !== 'unobserved' && (!lastReceivedAt || !reviewAfter)) return null;
  const base = { status: row.status as RefundReportFreshness['status'], lastReceivedAt, reviewAfter,
    configuredCadenceMinutes: 60 as const, reviewGraceMinutes: 120 as const };
  if (!isV2) return base;
  const deliveryStates = ['unobserved', 'file_received', 'explicit_empty', 'provider_failed', 'file_sent_awaiting_ingest', 'ordinary_silence'];
  const ingestStates = ['unknown', 'healthy', 'failed'];
  const coverageStates = ['unknown', 'declared_period'];
  const attentionReasons = [null, 'report_ingest_failed', 'provider_run_failed', 'provider_file_not_ingested'];
  const lastProviderRunAt = date(row.lastProviderRunAt);
  const lastRecordedAt = date(row.lastRecordedAt);
  if (!deliveryStates.includes(String(row.deliveryState)) || !ingestStates.includes(String(row.ingestState)) ||
    !coverageStates.includes(String(row.coverageState)) || !attentionReasons.includes(row.attentionReason as null | string) ||
    typeof row.attentionRequired !== 'boolean' || !Number.isSafeInteger(row.affectedCaseCount) ||
    Number(row.affectedCaseCount) < 0 || row.absenceIsNoRefundEvidence !== false || row.paymentRetryAuthorized !== false ||
    (row.lastProviderRunAt != null && !lastProviderRunAt) ||
    (row.lastRecordedAt != null && !lastRecordedAt) ||
    ((lastReceivedAt === null) !== (lastRecordedAt === null)) ||
    (row.status !== 'unobserved' && !lastReceivedAt && !lastProviderRunAt) ||
    (row.coverageState === 'unknown' && row.coverageReason !== 'provider_reporting_period_not_supplied') ||
    (row.coverageState === 'declared_period' && row.coverageReason !== null) ||
    (row.attentionRequired !== (row.attentionReason !== null)) ||
    (row.attentionRequired !== (row.status === 'needs_review')) ||
    ((row.status === 'unobserved') !== (row.deliveryState === 'unobserved')) ||
    (row.ingestState === 'failed' && row.attentionReason !== 'report_ingest_failed') ||
    (row.attentionReason === 'report_ingest_failed' && row.ingestState !== 'failed') ||
    (row.deliveryState === 'provider_failed' && row.ingestState !== 'failed' && row.attentionReason !== 'provider_run_failed') ||
    (row.attentionReason === 'provider_run_failed' && row.deliveryState !== 'provider_failed') ||
    (row.attentionReason === 'provider_file_not_ingested' && row.deliveryState !== 'file_sent_awaiting_ingest') ||
    (['explicit_empty', 'provider_failed', 'file_sent_awaiting_ingest'].includes(String(row.deliveryState)) && !lastProviderRunAt) ||
    (['file_received', 'ordinary_silence'].includes(String(row.deliveryState)) && !lastReceivedAt) ||
    (row.deliveryState === 'unobserved' && (lastReceivedAt || lastProviderRunAt || row.status !== 'unobserved'))) return null;
  return { ...base, schemaVersion: 'refund_report_health_v2',
    deliveryState: row.deliveryState as NonNullable<RefundReportFreshness['deliveryState']>,
    ingestState: row.ingestState as NonNullable<RefundReportFreshness['ingestState']>,
    coverageState: row.coverageState as NonNullable<RefundReportFreshness['coverageState']>,
    coverageReason: row.coverageReason as RefundReportFreshness['coverageReason'],
    attentionRequired: row.attentionRequired, attentionReason: row.attentionReason as RefundReportFreshness['attentionReason'],
    affectedCaseCount: Number(row.affectedCaseCount), lastProviderRunAt, lastRecordedAt,
    absenceIsNoRefundEvidence: false, paymentRetryAuthorized: false };
};
