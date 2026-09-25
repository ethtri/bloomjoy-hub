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
  decision?: "approved" | "denied" | null;
  workflowProjectionUnavailable?: boolean;
};

/** An older RPC cannot prove who owns an undecided final-money action. */
export const isRefundWorkflowProjectionUnavailable = (
  refundCase: RefundQueueCase,
): boolean => refundCase.decision == null &&
  (refundCase.workflowProjectionUnavailable === true || Boolean(refundCase.lifecycle &&
    !refundCase.lifecycle.nextWork && !refundCase.lifecycle.definitiveNoRefund &&
  refundCase.lifecycle.paymentState === 'not_requested' &&
  refundCase.lifecycle.managerQueue.bucket === 'ready_to_pay' &&
  (refundCase.paymentMethod === 'card' ||
    (refundCase.paymentMethod === 'cash' &&
      Boolean(refundCase.zellePaymentContact?.trim())))));

export type RefundQueueFilter =
  | Exclude<RefundManagerQueueBucket, 'accounting_review' | 'integrity_hold' | 'internal_archive'>
  | 'missing_information' | 'possible_duplicate' | 'aging' | 'blocked'
  | 'internal_test' | 'all';

/** Adapt server buckets to the existing visible filters without widening access. */
export const getRefundQueueFilterForCase = (
  refundCase: RefundQueueCase,
  refundOperationsAccess = true,
): RefundQueueFilter => {
  const bucket = getRefundManagerQueueBucket(refundCase);
  if (bucket === 'internal_archive') return refundOperationsAccess ? 'internal_test' : 'all';
  if (bucket === 'accounting_review' || bucket === 'integrity_hold' || bucket === 'provider_hold') {
    return 'provider_hold';
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
  const work = refundCase.lifecycle?.nextWork;
  if (work) {
    if (!work.isOpen) return 'completed';
    if (work.actor === 'customer') return 'waiting_on_customer';
    if (work.actor === 'manager') return 'ready_to_pay';
    // A due time can name scheduled work but cannot prove a worker has claimed
    // it. #1429 will add durable execution truth before a running label returns.
    return 'provider_hold';
  }
  if (refundCase.decision === 'approved' && refundCase.paymentMethod === 'card') {
    return refundCase.lifecycle?.paymentState === 'submitted_pending'
      ? 'in_progress' : 'provider_hold';
  }
  if (refundCase.workflowProjectionUnavailable) return 'provider_hold';
  if (refundCase.lifecycle &&
      ['outcome_unknown', 'integrity_unknown', 'submitted_pending'].includes(refundCase.lifecycle.paymentState)) {
    return 'provider_hold';
  }
  if (isRefundWorkflowProjectionUnavailable(refundCase)) return 'provider_hold';
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
