export const REFUND_GMAIL_RETENTION_POLICY_VERSION =
  "refund_gmail_retention_v1";
export const REFUND_GMAIL_QUARANTINE_BUCKET = "refund-gmail-quarantine";

export type RefundGmailWorkflowTrigger =
  | "scheduled"
  | "scheduler_primary"
  | "scheduler_recovery"
  | "manual"
  | "failure_test"
  | "retention";

const workflowRunKeyPatterns: Record<RefundGmailWorkflowTrigger, RegExp> = {
  scheduled: /^github-scheduled:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$/,
  scheduler_primary:
    /^supabase-primary:20[0-9]{6}T(?:[01][0-9]|2[0-3])[0-5]0Z$/,
  scheduler_recovery:
    /^supabase-recovery:20[0-9]{6}T(?:[01][0-9]|2[0-3])[0-5][05]Z$/,
  manual: /^github-manual:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$/,
  failure_test: /^github-failure-test:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$/,
  retention: /^github-retention:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$/,
};

export const isRefundGmailWorkflowRunKey = (
  runKey: string,
  trigger: string,
): trigger is RefundGmailWorkflowTrigger => {
  if (!(trigger in workflowRunKeyPatterns)) return false;
  return workflowRunKeyPatterns[trigger as RefundGmailWorkflowTrigger].test(
    runKey,
  );
};

export const refundGmailRetentionLedgerRunKey = (
  runKey: string,
  trigger: Exclude<RefundGmailWorkflowTrigger, "failure_test">,
) => trigger === "retention" ? `retention:${runKey}` : `pre-sync:${runKey}`;

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
  scannerEnabled: enabledValue(
    readEnv("REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED"),
  ),
  scannerVersion: safeVersion(
    readEnv("REFUND_GMAIL_ATTACHMENT_SCANNER_VERSION"),
  ),
});

const storageObjectName = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" ? record.name : "";
};

const storageUploadPath = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.path === "string" ? record.path : "";
};

const quarantinePathPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|png|bin)$/;

export const isRefundGmailQuarantineStorageTarget = (
  bucket: string,
  path: string,
) =>
  bucket === REFUND_GMAIL_QUARANTINE_BUCKET && quarantinePathPattern.test(path);

export const classifyRefundGmailStorageUpload = ({
  data,
  error,
  expectedPath,
}: {
  data: unknown;
  error: unknown;
  expectedPath: string;
}): "uploaded" | "upload_failed" | "upload_unknown" => {
  if (error) return "upload_failed";
  if (!expectedPath || storageUploadPath(data) !== expectedPath) {
    return "upload_unknown";
  }
  return "uploaded";
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
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
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
