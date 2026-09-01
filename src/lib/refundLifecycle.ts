export const REFUND_LIFECYCLE_SCHEMA_VERSION = "refund_lifecycle_v1" as const;

export const refundLifecycleStages = [
  "matching",
  "waiting_on_customer",
  "needs_transaction_selection",
  "transaction_confirmed",
  "refund_initiated",
  "confirming_with_nayax",
  "refund_confirmed",
  "customer_notified",
  "needs_refund_operations",
  "denied",
] as const;

export type RefundLifecycleStage = typeof refundLifecycleStages[number];

export const refundManagerQueueBuckets = [
  "needs_action",
  "ready_to_pay",
  "in_progress",
  "provider_hold",
  "waiting_on_customer",
  "completed",
] as const;

export type RefundManagerQueueBucket = typeof refundManagerQueueBuckets[number];

export type RefundManagerQueueContract = {
  schemaVersion: "refund_manager_queue_v1";
  bucket: RefundManagerQueueBucket;
  label: string;
  nextAction: string;
  safeRetryEligible: boolean;
  customerActionFields?: string[];
  payloadRedacted: true;
};

export type RefundLifecycleContract = {
  schemaVersion: typeof REFUND_LIFECYCLE_SCHEMA_VERSION;
  stage: RefundLifecycleStage;
  stageRank: number;
  evidenceState: string;
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
  return contract.schemaVersion === REFUND_LIFECYCLE_SCHEMA_VERSION &&
    typeof contract.stage === "string" && stageSet.has(contract.stage) &&
    typeof contract.stageRank === "number" &&
    typeof contract.lastUpdatedAt === "string" &&
    typeof contract.publicCopyKey === "string" &&
    typeof contract.managerNextAction === "string" &&
    typeof contract.terminal === "boolean" &&
    Boolean(managerQueue) &&
    managerQueue?.schemaVersion === "refund_manager_queue_v1" &&
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
