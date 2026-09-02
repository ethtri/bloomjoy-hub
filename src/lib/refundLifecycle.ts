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
    queue: "Refund Operations";
    owner: "Refund Operations";
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
    Boolean(operations) && operations?.queue === "Refund Operations" &&
    operations?.owner === "Refund Operations" &&
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
