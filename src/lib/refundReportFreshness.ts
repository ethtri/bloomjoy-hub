export type RefundReportFreshness = {
  status: 'unobserved' | 'recent' | 'needs_review';
  lastReceivedAt: string | null;
  reviewAfter: string | null;
  configuredCadenceMinutes: 60;
  reviewGraceMinutes: 120;
};

export const parseRefundReportFreshness = (value: unknown): RefundReportFreshness | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!['unobserved', 'recent', 'needs_review'].includes(String(row.status)) ||
    row.configuredCadenceMinutes !== 60 || row.reviewGraceMinutes !== 120) return null;
  const date = (candidate: unknown) => typeof candidate === 'string' && Number.isFinite(Date.parse(candidate)) ? candidate : null;
  const lastReceivedAt = date(row.lastReceivedAt);
  const reviewAfter = date(row.reviewAfter);
  if (row.status !== 'unobserved' && (!lastReceivedAt || !reviewAfter)) return null;
  return { status: row.status as RefundReportFreshness['status'], lastReceivedAt, reviewAfter,
    configuredCadenceMinutes: 60, reviewGraceMinutes: 120 };
};
