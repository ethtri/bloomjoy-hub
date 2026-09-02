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
