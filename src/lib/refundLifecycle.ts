export const REFUND_LIFECYCLE_SCHEMA_VERSION = "refund_lifecycle_v2" as const;

export const refundLifecycleStages = [
  "matching",
  "waiting_on_customer",
  "needs_transaction_selection",
  "transaction_confirmed",
  "awaiting_payout",
  "refund_initiated",
  "confirming_with_nayax",
  "refund_confirmed",
  "customer_notified",
  "needs_refund_operations",
  "integrity_hold",
  "denied",
  "unable_to_complete",
  "internal_test_archived",
] as const;

export type RefundLifecycleStage = typeof refundLifecycleStages[number];

export const refundManagerQueueBuckets = [
  "needs_action",
  "ready_to_pay",
  "in_progress",
  "provider_hold",
  "accounting_review",
  "integrity_hold",
  "waiting_on_customer",
  "completed",
  "internal_archive",
] as const;

export type RefundManagerQueueBucket = typeof refundManagerQueueBuckets[number];

export type RefundManagerQueueContract = {
  schemaVersion: "refund_manager_queue_v2";
  bucket: RefundManagerQueueBucket;
  label: string;
  nextAction: string;
  safeRetryEligible: boolean;
  customerActionFields?: string[];
  payloadRedacted: true;
};

export type RefundAccountingState = {
  state: "pending";
  owner: "Refund Operations";
  settlementTimePrecision: "unknown";
  settledAt: null;
  blocksPaymentCompletion: false;
  blocksCustomerNotice: false;
  payloadRedacted: true;
};

export type RefundLifecycleContract = {
  schemaVersion: typeof REFUND_LIFECYCLE_SCHEMA_VERSION;
  version: number;
  stage: RefundLifecycleStage;
  stageRank: number;
  reasonCode: string;
  actor: "customer" | "manager" | "service" | "system";
  customerAction: {
    action: string;
    required: boolean;
    requestedFields: string[];
    payloadRedacted: true;
  };
  managerAction: {
    action: string;
    owner: string;
    safeRetryEligible: boolean;
    payloadRedacted: true;
  };
  paymentState: string;
  paymentWorkComplete?: true;
  accountingState?: RefundAccountingState;
  messageState: {
    state: string;
    messageType: string | null;
    lastUpdatedAt: string | null;
    payloadRedacted: true;
  };
  classification: "customer" | "internal_test";
  evidenceState: string;
  locationEvidence: {
    customerReported: {
      selectionKey: string | null;
      selectionKind: string | null;
      machineIds: string[] | null;
      preserved: boolean;
      payloadRedacted: true;
    };
    normalized: {
      locationId: string | null;
      machineId: string | null;
      timezone: string | null;
      providerAccountKey: string | null;
      mappingSource: string | null;
      mappingVersion: number;
      confidence: number;
      authoritative: boolean;
      payloadRedacted: true;
    };
    payloadRedacted: true;
  };
  lastUpdatedAt: string;
  publicCopyKey: string;
  managerNextAction: string;
  terminal: boolean;
  refreshAfterSeconds: number | null;
  managerQueue: RefundManagerQueueContract;
  managerVisibility?: "restricted";
  definitiveNoRefund?: boolean;
  safeRetryEligible?: boolean;
  lookup: {
    status: string;
    safeRetryEligible: boolean;
    failureClass: string | null;
    lastUpdatedAt: string | null;
  };
  operations: {
    required: boolean;
    queue: "Refund Operations" | "System";
    owner: "Refund Operations" | "System";
    slaMinutes: 60;
    ageMinutes: number | null;
    dueAt: string | null;
    slaBreached: boolean;
    safeStage: string;
    failureClass: string | null;
    nextStep: string | null;
  };
  payloadRedacted: true;
};

const stageSet = new Set<string>(refundLifecycleStages);
const managerQueueBucketSet = new Set<string>(refundManagerQueueBuckets);
const exactObjectKeys = (value: Record<string, unknown>, expected: string[]) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
};

export const isRefundLifecycleContract = (
  value: unknown,
): value is RefundLifecycleContract => {
  if (!value || typeof value !== "object") return false;
  const contract = value as Record<string, unknown>;
  const lookup = contract.lookup as Record<string, unknown> | null;
  const operations = contract.operations as Record<string, unknown> | null;
  const managerQueue = contract.managerQueue as Record<string, unknown> | null;
  const customerAction = contract.customerAction as Record<string, unknown> | null;
  const managerAction = contract.managerAction as Record<string, unknown> | null;
  const messageState = contract.messageState as Record<string, unknown> | null;
  const locationEvidence = contract.locationEvidence as Record<string, unknown> | null;
  const customerReported = locationEvidence?.customerReported as Record<string, unknown> | null;
  const normalizedLocation = locationEvidence?.normalized as Record<string, unknown> | null;
  const accountingState = contract.accountingState as Record<string, unknown> | null;
  const hasAccountingState = contract.paymentWorkComplete !== undefined ||
    contract.accountingState !== undefined;
  const hasRestrictedManagerProjection = contract.managerVisibility !== undefined;
  const noticeComplete = ["sent", "delivered"].includes(String(messageState?.state));
  const projectedAction = noticeComplete ? "none" : "wait";
  const projectedBucket = noticeComplete ? "completed" : "in_progress";
  const projectedLabel = noticeComplete
    ? "Refund confirmed · customer notified"
    : messageState?.state === "pending"
    ? "Refund confirmed · customer notice queued"
    : ["failed", "delivery_unconfirmed"].includes(String(messageState?.state))
    ? "Refund confirmed · customer notice delivery pending"
    : "Refund confirmed · customer notice pending";
  const projectedReason = noticeComplete
    ? "completion_sent"
    : messageState?.state === "delivery_unconfirmed"
    ? "completion_delivery_unconfirmed"
    : messageState?.state === "failed"
    ? "completion_delivery_failed"
    : "customer_notification_pending";
  return contract.schemaVersion === REFUND_LIFECYCLE_SCHEMA_VERSION &&
    typeof contract.version === "number" && Number.isSafeInteger(contract.version) &&
    contract.version >= 1 &&
    typeof contract.stage === "string" && stageSet.has(contract.stage) &&
    typeof contract.stageRank === "number" &&
    typeof contract.reasonCode === "string" && contract.reasonCode.length > 0 &&
    ["customer", "manager", "service", "system"].includes(String(contract.actor)) &&
    Boolean(customerAction) && typeof customerAction?.action === "string" &&
    typeof customerAction?.required === "boolean" &&
    Array.isArray(customerAction?.requestedFields) &&
    customerAction.requestedFields.every((field) => typeof field === "string") &&
    customerAction?.payloadRedacted === true &&
    Boolean(managerAction) && typeof managerAction?.action === "string" &&
    typeof managerAction?.owner === "string" &&
    typeof managerAction?.safeRetryEligible === "boolean" &&
    managerAction?.payloadRedacted === true &&
    typeof contract.paymentState === "string" &&
    (!hasAccountingState ||
      (contract.paymentWorkComplete === true &&
        Boolean(accountingState) &&
        exactObjectKeys(accountingState!, [
          "blocksCustomerNotice", "blocksPaymentCompletion", "owner", "payloadRedacted",
          "settledAt", "settlementTimePrecision", "state",
        ]) &&
        contract.reasonCode === "settlement_time_unknown" &&
        contract.paymentState === "confirmed" &&
        ["refund_confirmed", "customer_notified"].includes(String(contract.stage)) &&
        contract.safeRetryEligible === false &&
        contract.managerNextAction === "review_accounting_date" &&
        contract.terminal === noticeComplete &&
        contract.refreshAfterSeconds === (noticeComplete ? null : 5) &&
        exactObjectKeys(managerAction!, [
          "action", "owner", "payloadRedacted", "safeRetryEligible",
        ]) &&
        managerAction?.action === "review_accounting_date" &&
        managerAction?.owner === "Refund Operations" &&
        managerAction?.safeRetryEligible === false &&
        managerAction?.payloadRedacted === true &&
        Boolean(managerQueue) &&
        exactObjectKeys(managerQueue!, [
          "bucket", "customerActionFields", "label", "nextAction", "payloadRedacted",
          "safeRetryEligible", "schemaVersion",
        ]) &&
        managerQueue?.schemaVersion === "refund_manager_queue_v2" &&
        managerQueue?.bucket === "accounting_review" &&
        managerQueue?.label === "Refund confirmed · accounting review" &&
        managerQueue?.nextAction === "review_accounting_date" &&
        managerQueue?.safeRetryEligible === false &&
        Array.isArray(managerQueue?.customerActionFields) &&
        managerQueue.customerActionFields.length === 0 &&
        managerQueue?.payloadRedacted === true &&
        lookup?.safeRetryEligible === false &&
        operations?.required === true &&
        operations?.queue === "Refund Operations" &&
        operations?.owner === "Refund Operations" &&
        operations?.safeStage === "payment_confirmed_accounting_pending" &&
        operations?.failureClass === "settlement_time_unknown" &&
        accountingState?.state === "pending" &&
        accountingState?.owner === "Refund Operations" &&
        accountingState?.settlementTimePrecision === "unknown" &&
        accountingState?.settledAt === null &&
        accountingState?.blocksPaymentCompletion === false &&
        accountingState?.blocksCustomerNotice === false &&
        accountingState?.payloadRedacted === true)) &&
    (!hasRestrictedManagerProjection ||
      (contract.managerVisibility === "restricted" &&
        !hasAccountingState &&
        contract.paymentState === "confirmed" &&
        ["refund_confirmed", "customer_notified"].includes(String(contract.stage)) &&
        contract.reasonCode === projectedReason &&
        contract.safeRetryEligible === false &&
        lookup?.safeRetryEligible === false &&
        contract.managerNextAction === projectedAction &&
        contract.terminal === noticeComplete &&
        contract.refreshAfterSeconds === (noticeComplete ? null : 5) &&
        exactObjectKeys(managerAction!, [
          "action", "owner", "payloadRedacted", "safeRetryEligible",
        ]) &&
        managerAction?.action === projectedAction &&
        managerAction?.owner === "System" &&
        managerAction?.safeRetryEligible === false &&
        managerAction?.payloadRedacted === true &&
        Boolean(managerQueue) &&
        exactObjectKeys(managerQueue!, [
          "bucket", "customerActionFields", "label", "nextAction", "payloadRedacted",
          "safeRetryEligible", "schemaVersion",
        ]) &&
        managerQueue?.schemaVersion === "refund_manager_queue_v2" &&
        managerQueue?.bucket === projectedBucket &&
        managerQueue?.label === projectedLabel &&
        managerQueue?.nextAction === projectedAction &&
        managerQueue?.safeRetryEligible === false &&
        Array.isArray(managerQueue?.customerActionFields) &&
        managerQueue.customerActionFields.length === 0 &&
        managerQueue?.payloadRedacted === true &&
        Boolean(operations) &&
        exactObjectKeys(operations!, [
          "ageMinutes", "dueAt", "failureClass", "nextStep", "owner", "queue",
          "required", "safeStage", "slaBreached", "slaMinutes",
        ]) &&
        operations?.required === false &&
        operations?.queue === "System" &&
        operations?.owner === "System" &&
        operations?.slaMinutes === 60 &&
        operations?.ageMinutes === null &&
        operations?.dueAt === null &&
        operations?.slaBreached === false &&
        operations?.safeStage === (noticeComplete
          ? "customer_notice_complete"
          : "customer_notice_pending") &&
        operations?.failureClass === null &&
        operations?.nextStep === null)) &&
    Boolean(messageState) && typeof messageState?.state === "string" &&
    messageState?.payloadRedacted === true &&
    ["customer", "internal_test"].includes(String(contract.classification)) &&
    typeof contract.evidenceState === "string" &&
    Boolean(locationEvidence) && locationEvidence?.payloadRedacted === true &&
    Boolean(customerReported) && customerReported?.payloadRedacted === true &&
    typeof customerReported?.preserved === "boolean" &&
    (customerReported?.machineIds === null || Array.isArray(customerReported?.machineIds)) &&
    Boolean(normalizedLocation) && normalizedLocation?.payloadRedacted === true &&
    typeof normalizedLocation?.mappingVersion === "number" &&
    typeof normalizedLocation?.confidence === "number" &&
    typeof normalizedLocation?.authoritative === "boolean" &&
    typeof contract.lastUpdatedAt === "string" &&
    typeof contract.publicCopyKey === "string" &&
    typeof contract.managerNextAction === "string" &&
    typeof contract.terminal === "boolean" &&
    Boolean(managerQueue) &&
    managerQueue?.schemaVersion === "refund_manager_queue_v2" &&
    typeof managerQueue?.bucket === "string" &&
    managerQueueBucketSet.has(managerQueue.bucket) &&
    typeof managerQueue?.label === "string" &&
    typeof managerQueue?.nextAction === "string" &&
    typeof managerQueue?.safeRetryEligible === "boolean" &&
    (managerQueue?.customerActionFields === undefined ||
      (Array.isArray(managerQueue.customerActionFields) &&
        managerQueue.customerActionFields.every((field) => typeof field === "string"))) &&
    managerQueue?.payloadRedacted === true &&
    (contract.definitiveNoRefund === undefined ||
      typeof contract.definitiveNoRefund === "boolean") &&
    (contract.safeRetryEligible === undefined ||
      typeof contract.safeRetryEligible === "boolean") &&
    contract.payloadRedacted === true &&
    Boolean(lookup) && typeof lookup?.status === "string" &&
    typeof lookup?.safeRetryEligible === "boolean" &&
    Boolean(operations) &&
    ((hasRestrictedManagerProjection && operations?.queue === "System" &&
      operations?.owner === "System") ||
      (!hasRestrictedManagerProjection && operations?.queue === "Refund Operations" &&
        operations?.owner === "Refund Operations")) &&
    operations?.slaMinutes === 60 &&
    typeof operations?.required === "boolean";
};

export const requireRefundLifecycleContract = (
  value: unknown,
): RefundLifecycleContract => {
  if (!isRefundLifecycleContract(value)) {
    throw new Error("Unsupported refund lifecycle response.");
  }
  return value;
};
