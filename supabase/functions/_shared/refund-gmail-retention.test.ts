import {
  classifyRefundGmailStorageDelete,
  classifyRefundGmailStorageUpload,
  getRefundGmailRetentionRuntimeConfig,
  isRefundGmailQuarantineStorageTarget,
  isRefundGmailWorkflowRunKey,
  redactedRefundGmailRetentionSummary,
  REFUND_GMAIL_QUARANTINE_BUCKET,
  REFUND_GMAIL_RETENTION_POLICY_VERSION,
  refundGmailRetentionLedgerRunKey,
} from "./refund-gmail-retention.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("retention and scanner gates default off", () => {
  const config = getRefundGmailRetentionRuntimeConfig(() => undefined);
  assert(!config.workerEnabled, "retention worker must default off");
  assert(!config.scannerEnabled, "attachment scanner must default off");
  assert(
    config.policyVersion === "",
    "policy acknowledgement must be explicit",
  );
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
  assert(
    config.policyVersion === REFUND_GMAIL_RETENTION_POLICY_VERSION,
    "policy version should match",
  );
  assert(
    config.scannerVersion === "scanner-v1.2",
    "scanner version should be preserved",
  );
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

Deno.test("workflow run keys bind one numeric GitHub run and attempt to the exact trigger", () => {
  assert(
    isRefundGmailWorkflowRunKey("github-scheduled:123456789:1", "scheduled"),
    "scheduled workflow key should be accepted",
  );
  assert(
    isRefundGmailWorkflowRunKey(
      "supabase-recovery:20260827T0410Z",
      "scheduler_recovery",
    ),
    "Supabase recovery key should be accepted",
  );
  assert(
    isRefundGmailWorkflowRunKey("github-manual:123456789:2", "manual"),
    "manual workflow key should be accepted",
  );
  assert(
    isRefundGmailWorkflowRunKey(
      "github-failure-test:123456789:3",
      "failure_test",
    ),
    "failure-test workflow key should be accepted",
  );
  assert(
    isRefundGmailWorkflowRunKey("github-retention:123456789:4", "retention"),
    "retention workflow key should be accepted",
  );
  assert(
    refundGmailRetentionLedgerRunKey(
      "github-retention:123456789:4",
      "retention",
    ) ===
      "retention:github-retention:123456789:4",
    "retention ledger key should keep the retention trigger prefix",
  );
  assert(
    refundGmailRetentionLedgerRunKey("github-manual:123456789:2", "manual") ===
      "pre-sync:github-manual:123456789:2",
    "pre-sync ledger key should bind the manual trigger",
  );
});

Deno.test("workflow run keys reject identifiers and wrong trigger prefixes", () => {
  for (
    const [runKey, trigger] of [
      ["550e8400-e29b-41d4-a716-446655440000", "manual"],
      ["RF-2026-000123", "manual"],
      ["18c7aProviderMessageToken", "scheduled"],
      ["18005551212", "scheduled"],
      ["github-manual:123456789:1", "scheduled"],
      ["supabase-recovery:20260827T0410Z", "scheduled"],
      ["supabase-recovery:20260827T0411Z", "scheduler_recovery"],
      ["supabase-recovery:20260827T0410Z", "manual"],
      ["github-retention:123456789:1", "manual"],
      ["github-failure_test:123456789:1", "failure_test"],
      ["github-manual:0123:1", "manual"],
      ["github-manual:123:0", "manual"],
    ]
  ) {
    assert(
      !isRefundGmailWorkflowRunKey(runKey, trigger),
      `unsafe key should be rejected: ${runKey}`,
    );
  }
});

Deno.test("quarantine targets are restricted to the UUID-derived private bucket shape", () => {
  const path =
    "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf";
  assert(
    isRefundGmailQuarantineStorageTarget(REFUND_GMAIL_QUARANTINE_BUCKET, path),
    "canonical quarantine target should be accepted",
  );
  assert(
    !isRefundGmailQuarantineStorageTarget("another-bucket", path),
    "another bucket must be rejected",
  );
  assert(
    !isRefundGmailQuarantineStorageTarget(
      REFUND_GMAIL_QUARANTINE_BUCKET,
      "../another-bucket/object.pdf",
    ),
    "caller-shaped paths must be rejected",
  );
});

Deno.test("upload settlement requires exact accepted-path evidence", () => {
  const expectedPath =
    "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf";
  assert(
    classifyRefundGmailStorageUpload({
      data: { path: expectedPath },
      error: null,
      expectedPath,
    }) === "uploaded",
    "exact returned path should confirm upload",
  );
  assert(
    classifyRefundGmailStorageUpload({
      data: null,
      error: { message: "redacted" },
      expectedPath,
    }) === "upload_failed",
    "explicit provider failure should settle as failed without clearing coordinates",
  );
  assert(
    classifyRefundGmailStorageUpload({
      data: { path: "mismatched/object.pdf" },
      error: null,
      expectedPath,
    }) === "upload_unknown",
    "mismatched success evidence must remain unknown",
  );
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
  assert(
    summary.attachmentsRetryRequired === 0,
    "negative count should fail closed",
  );
  assert(
    summary.attachmentsManualReview === 3,
    "numeric count should normalize",
  );
  assert(!("storagePath" in summary), "object path must not escape");
  assert(!("recipientEmail" in summary), "address must not escape");
  assert(!("providerId" in summary), "provider identifier must not escape");
  assert(summary.payloadRedacted, "summary must declare redaction");
});
