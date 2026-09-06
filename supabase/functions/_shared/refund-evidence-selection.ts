export type RefundEvidenceSelectionRequest = {
  hasNayaxCandidate: boolean;
  requestedStatus: string | null;
  requestedDecision: string | null;
  requestedMessageType: string | null;
};

const evidenceSelectionError =
  "Saving transaction evidence cannot approve or complete a refund, change it to ready to refund, or contact the customer.";

export const validateRefundEvidenceSelectionRequest = ({
  hasNayaxCandidate,
  requestedStatus,
  requestedDecision,
  requestedMessageType,
}: RefundEvidenceSelectionRequest): string | null => {
  if (!hasNayaxCandidate) return null;

  const isCombinedSelectionApproval =
    requestedStatus === "card_refund_pending" &&
    requestedDecision === "approved" &&
    requestedMessageType === null;

  if (
    !isCombinedSelectionApproval &&
    (
      requestedStatus !== "needs_review" ||
      requestedDecision !== null ||
      requestedMessageType !== null
    )
  ) {
    return evidenceSelectionError;
  }

  return null;
};

export type CardPreExecutionRequest = {
  isCardCase: boolean;
  hasNayaxCandidate: boolean;
  requestedStatus: string | null;
  requestedDecision: string | null;
  requestedMessageType: string | null;
};

export const validateCardPreExecutionRequest = ({
  isCardCase,
  hasNayaxCandidate,
  requestedStatus,
  requestedDecision,
  requestedMessageType,
}: CardPreExecutionRequest): string | null => {
  if (!isCardCase) return null;

  const isCombinedSelectionApproval =
    hasNayaxCandidate &&
    requestedStatus === "card_refund_pending" &&
    requestedDecision === "approved" &&
    requestedMessageType === null;
  if (isCombinedSelectionApproval) return null;

  const impliesPreExecutionApproval =
    requestedStatus === "approved" ||
    requestedStatus === "card_refund_pending" ||
    (requestedDecision === "approved" && requestedStatus !== "completed") ||
    requestedMessageType === "approved";

  return impliesPreExecutionApproval
    ? "Card transaction review cannot approve a refund or send an approval email. Issue the provider refund first."
    : null;
};

export type RefundCustomerMessageRequest = {
  paymentMethod: string | null;
  caseStatus: string;
  messageType: string;
};

export const validateRefundCustomerMessageRequest = ({
  paymentMethod,
  caseStatus,
  messageType,
}: RefundCustomerMessageRequest): string | null => {
  if (paymentMethod === "card" && messageType === "approved") {
    return "Card refunds do not send a separate approval email. Notify the customer only after the provider refund succeeds.";
  }

  if (messageType === "completed" && caseStatus !== "completed") {
    return "A refund completion email can be sent only after the case is complete.";
  }

  return null;
};
