import { dispatchRefundCaseGmailReply } from "./refund-gmail-transport.ts";
import { RefundGmailError } from "./refund-gmail.ts";
import {
  deliverNayaxCompletionWithDefiniteRetry,
  deliverNayaxFormReceiptCompletion,
  parseNayaxFormReceiptClaim,
} from "./nayax-resolution-completion.ts";
import { drainRefundManualMessageOutbox } from "./refund-manual-message-outbox.ts";
import { buildRefundStoredTextWithStatus } from "./refund-email.ts";
import { tryIssueRefundStatusCapabilityForMessage } from "./refund-status-capability.ts";
import type { NayaxCompletionDelivery } from "./nayax-refund-orchestration.ts";

type RefundServiceClient = Parameters<
  typeof drainRefundManualMessageOutbox
>[0]["supabase"];

export const deliverNayaxRefundCustomerCompletion = async ({
  supabase,
  executorAssertion,
  attemptId,
  caseId,
}: {
  supabase: RefundServiceClient;
  executorAssertion: string;
  attemptId: string;
  caseId: string;
}): Promise<NayaxCompletionDelivery> => {
  const { data: claimData, error: claimError } = await supabase.rpc(
    "service_claim_nayax_refund_completion",
    { p_executor_assertion: executorAssertion, p_attempt_id: attemptId },
  );
  const claim = claimData && typeof claimData === "object"
    ? claimData as Record<string, unknown>
    : null;
  const formClaim = claimError
    ? null
    : parseNayaxFormReceiptClaim(claim, caseId);
  if (formClaim) {
    return await deliverNayaxFormReceiptCompletion({
      claim: formClaim,
      drain: (messageId) =>
        drainRefundManualMessageOutbox({ supabase, messageId, limit: 1 }),
    }) as NayaxCompletionDelivery;
  }
  if (
    claimError || !claim || typeof claim.refundCaseId !== "string" ||
    typeof claim.refundCaseMessageId !== "string" ||
    typeof claim.gmailThreadId !== "string" ||
    typeof claim.recipientEmail !== "string" ||
    typeof claim.subject !== "string" || typeof claim.body !== "string"
  ) throw new Error("nayax_completion_claim_invalid");

  return await deliverNayaxCompletionWithDefiniteRetry({
    deliver: async () => {
      const statusCapability = await tryIssueRefundStatusCapabilityForMessage({
        supabase,
        refundCaseId: claim.refundCaseId as string,
        refundCaseMessageId: claim.refundCaseMessageId as string,
      });
      const completionEmail = buildRefundStoredTextWithStatus({
        headline: "Your refund is on its way",
        text: claim.body as string,
        statusUrl: statusCapability?.url ?? null,
      });
      const gmailDelivery = await dispatchRefundCaseGmailReply({
        supabase,
        refundCaseId: claim.refundCaseId as string,
        refundCaseMessageId: claim.refundCaseMessageId as string,
        recipientEmail: claim.recipientEmail as string,
        email: {
          subject: claim.subject as string,
          text: completionEmail.text,
          html: completionEmail.html,
        },
        deliveryKind: "manual",
        gmailThreadId: claim.gmailThreadId as string,
      });
      return gmailDelivery.usedGmail;
    },
    finish: async (status) => {
      const { data, error } = await supabase.rpc(
        "service_finish_nayax_refund_completion",
        {
          p_executor_assertion: executorAssertion,
          p_attempt_id: attemptId,
          p_delivery_status: status,
        },
      );
      if (error || !data || typeof data !== "object") {
        throw new Error("nayax_completion_finish_failed");
      }
      return data as NayaxCompletionDelivery;
    },
    isDeliveryUncertain: (error) =>
      error instanceof RefundGmailError && error.deliveryUncertain,
    prepareSameMessageRetry: async () => {
      const { data, error } = await supabase.rpc(
        "service_prepare_nayax_completion_retry",
        {
          p_executor_assertion: executorAssertion,
          p_refund_case_message_id: claim.refundCaseMessageId,
        },
      );
      const retry = data && typeof data === "object"
        ? data as Record<string, unknown>
        : null;
      return !error && retry?.prepared === true &&
        retry.refundCaseId === claim.refundCaseId &&
        retry.refundCaseMessageId === claim.refundCaseMessageId &&
        retry.attemptId === attemptId &&
        retry.gmailThreadId === claim.gmailThreadId &&
        retry.recipientEmail === claim.recipientEmail &&
        retry.subject === claim.subject && retry.body === claim.body &&
        retry.retryCount === 1 && retry.originalThread === true &&
        retry.payloadRedacted === true;
    },
  }) as NayaxCompletionDelivery;
};
