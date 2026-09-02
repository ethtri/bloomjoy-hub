import type {
  RefundLifecycleContract,
  RefundManagerQueueBucket,
} from "./refundLifecycle.ts";

type RefundQueueCase = {
  lifecycle?: RefundLifecycleContract | null;
  status: string;
  paymentMethod: "card" | "cash" | "unknown";
  paymentAmountCents?: number | null;
  zellePaymentContact?: string | null;
};

export type RefundQueueFilter =
  | Exclude<RefundManagerQueueBucket, 'integrity_hold' | 'internal_archive'>
  | 'missing_information' | 'possible_duplicate' | 'aging' | 'blocked'
  | 'internal_test' | 'all';

/** Adapt server buckets to the existing visible filters without widening access. */
export const getRefundQueueFilterForCase = (
  refundCase: RefundQueueCase,
  refundOperationsAccess = true,
): RefundQueueFilter => {
  const bucket = getRefundManagerQueueBucket(refundCase);
  if (bucket === 'internal_archive') return refundOperationsAccess ? 'internal_test' : 'all';
  if (bucket === 'integrity_hold' || bucket === 'provider_hold') {
    return refundOperationsAccess ? 'provider_hold' : 'all';
  }
  return bucket;
};

/** The caller supplies only archive cases already authorized by the overview. */
export const findRefundDeepLinkedCase = <T extends { id: string }>(
  caseId: string,
  customerCases: readonly T[],
  authorizedArchiveCases: readonly T[],
): T | undefined => customerCases.find((item) => item.id === caseId)
  ?? authorizedArchiveCases.find((item) => item.id === caseId);

/**
 * Manager queue consumers must prefer the redacted server projection. The
 * fallback exists only for Gmail drafts and local fixtures that predate a
 * durable refund case; it must never reinterpret a server lifecycle.
 */
export const getRefundManagerQueueBucket = (
  refundCase: RefundQueueCase,
): RefundManagerQueueBucket => {
  if (refundCase.lifecycle) return refundCase.lifecycle.managerQueue.bucket;
  if (["completed", "denied", "closed"].includes(refundCase.status))
    return "completed";
  if (refundCase.status === "waiting_on_customer") return "waiting_on_customer";
  if (
    refundCase.paymentMethod === "cash" &&
    typeof refundCase.paymentAmountCents === "number" &&
    refundCase.paymentAmountCents > 0 &&
    Boolean(refundCase.zellePaymentContact?.trim())
  ) {
    return "ready_to_pay";
  }
  return "needs_action";
};

export const refundCaseBelongsToManagerQueue = (
  refundCase: RefundQueueCase,
  bucket: RefundManagerQueueBucket,
) => getRefundManagerQueueBucket(refundCase) === bucket;
