import {
  classifyRefundGmailStorageDelete,
  getRefundGmailRetentionRuntimeConfig,
  redactedRefundGmailRetentionSummary,
  REFUND_GMAIL_RETENTION_POLICY_VERSION,
} from "./refund-gmail-retention.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("retention and scanner gates default off", () => {
  const config = getRefundGmailRetentionRuntimeConfig(() => undefined);
  assert(!config.workerEnabled, "retention worker must default off");
  assert(!config.scannerEnabled, "attachment scanner must default off");
  assert(config.policyVersion === "", "policy acknowledgement must be explicit");
  assert(config.scannerVersion === "", "scanner version must be explicit");
});

Deno.test("retention runtime accepts only explicit bounded configuration", () => {
  const values: Record<string, string> = {
    REFUND_GMAIL_RETENTION_ENABLED: "true",
    REFUND_GMAIL_RETENTION_POLICY_VERSION,
    REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED: "on",
    REFUND_GMAIL_ATTACHMENT_SCANNER_VERSION: "scanner-v1.2",
  };
  const config = getRefundGmailRetentionRuntimeConfig((name) => values[name]);
  assert(config.workerEnabled, "explicit retention enable should be accepted");
  assert(config.scannerEnabled, "explicit scanner enable should be accepted");
  assert(config.policyVersion === REFUND_GMAIL_RETENTION_POLICY_VERSION, "policy version should match");
  assert(config.scannerVersion === "scanner-v1.2", "scanner version should be preserved");
});

Deno.test("invalid runtime versions fail closed", () => {
  const values: Record<string, string> = {
    REFUND_GMAIL_RETENTION_ENABLED: "true",
    REFUND_GMAIL_RETENTION_POLICY_VERSION: "contains spaces and / separators",
    REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED: "true",
    REFUND_GMAIL_ATTACHMENT_SCANNER_VERSION: "x",
  };
  const config = getRefundGmailRetentionRuntimeConfig((name) => values[name]);
  assert(config.policyVersion === "", "invalid policy version must be empty");
  assert(config.scannerVersion === "", "invalid scanner version must be empty");
});

Deno.test("storage metadata settles only on exact delete evidence", () => {
  assert(
    classifyRefundGmailStorageDelete({
      data: [{ name: "case/message/object.pdf" }],
      error: null,
      expectedPath: "case/message/object.pdf",
    }) === "deleted",
    "exact returned object path should confirm byte deletion",
  );
  assert(
    classifyRefundGmailStorageDelete({
      data: [{ name: "different/object.pdf" }],
      error: null,
      expectedPath: "case/message/object.pdf",
    }) === "delete_unknown",
    "mismatched provider evidence must be unknown",
  );
});

Deno.test("explicit storage failure is retryable while missing evidence is unknown", () => {
  assert(
    classifyRefundGmailStorageDelete({
      data: null,
      error: { message: "redacted" },
      expectedPath: "case/message/object.pdf",
    }) === "delete_failed",
    "an explicit provider error should remain retryable",
  );
  assert(
    classifyRefundGmailStorageDelete({
      data: null,
      error: null,
      expectedPath: "case/message/object.pdf",
    }) === "delete_unknown",
    "missing success evidence must never finalize metadata",
  );
});

Deno.test("retention summaries discard unexpected fields and invalid counts", () => {
  const summary = redactedRefundGmailRetentionSummary({
    status: "succeeded",
    attachmentsDeleted: 2,
    attachmentsRetryRequired: -1,
    attachmentsManualReview: "3",
    attachmentMetadataPurged: 4,
    messagesPurged: 5,
    errorCode: null,
    storagePath: "must-not-escape",
    recipientEmail: "must-not-escape@example.test",
    providerId: "must-not-escape",
  });
  assert(summary.status === "succeeded", "safe status should survive");
  assert(summary.attachmentsDeleted === 2, "safe count should survive");
  assert(summary.attachmentsRetryRequired === 0, "negative count should fail closed");
  assert(summary.attachmentsManualReview === 3, "numeric count should normalize");
  assert(!("storagePath" in summary), "object path must not escape");
  assert(!("recipientEmail" in summary), "address must not escape");
  assert(!("providerId" in summary), "provider identifier must not escape");
  assert(summary.payloadRedacted, "summary must declare redaction");
});
