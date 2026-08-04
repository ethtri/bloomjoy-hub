export const REFUND_GMAIL_RETENTION_POLICY_VERSION = "refund_gmail_retention_v1";

export type RefundGmailRetentionRuntimeConfig = {
  workerEnabled: boolean;
  policyVersion: string;
  scannerEnabled: boolean;
  scannerVersion: string;
};

export type RefundGmailRetentionSummary = {
  status: string;
  attachmentsDeleted: number;
  attachmentsRetryRequired: number;
  attachmentsManualReview: number;
  attachmentMetadataPurged: number;
  messagesPurged: number;
  errorCode: string | null;
};

const enabledValue = (value: string | undefined) =>
  ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());

const safeVersion = (value: string | undefined) => {
  const normalized = (value ?? "").trim();
  return /^[a-zA-Z0-9._-]{3,80}$/.test(normalized) ? normalized : "";
};

export const getRefundGmailRetentionRuntimeConfig = (
  readEnv: (name: string) => string | undefined,
): RefundGmailRetentionRuntimeConfig => ({
  workerEnabled: enabledValue(readEnv("REFUND_GMAIL_RETENTION_ENABLED")),
  policyVersion: safeVersion(readEnv("REFUND_GMAIL_RETENTION_POLICY_VERSION")),
  scannerEnabled: enabledValue(readEnv("REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED")),
  scannerVersion: safeVersion(readEnv("REFUND_GMAIL_ATTACHMENT_SCANNER_VERSION")),
});

const storageObjectName = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" ? record.name : "";
};

export const classifyRefundGmailStorageDelete = ({
  data,
  error,
  expectedPath,
}: {
  data: unknown;
  error: unknown;
  expectedPath: string;
}): "deleted" | "delete_failed" | "delete_unknown" => {
  if (error) return "delete_failed";
  if (!expectedPath || !Array.isArray(data)) return "delete_unknown";
  return data.some((item) => storageObjectName(item) === expectedPath)
    ? "deleted"
    : "delete_unknown";
};

const aggregateCount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const safeCode = (value: unknown) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9_]{3,80}$/.test(normalized) ? normalized : null;
};

export const redactedRefundGmailRetentionSummary = (
  value: Record<string, unknown> | null | undefined,
): RefundGmailRetentionSummary & { payloadRedacted: true } => ({
  status: safeCode(value?.status) ?? "failed",
  attachmentsDeleted: aggregateCount(value?.attachmentsDeleted),
  attachmentsRetryRequired: aggregateCount(value?.attachmentsRetryRequired),
  attachmentsManualReview: aggregateCount(value?.attachmentsManualReview),
  attachmentMetadataPurged: aggregateCount(value?.attachmentMetadataPurged),
  messagesPurged: aggregateCount(value?.messagesPurged),
  errorCode: safeCode(value?.errorCode),
  payloadRedacted: true,
});
