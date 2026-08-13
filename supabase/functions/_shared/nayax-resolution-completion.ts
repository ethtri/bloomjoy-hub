export type NayaxCompletionDeliveryStatus =
  | "sent"
  | "failed"
  | "delivery_unknown";

export type NayaxCompletionResult = Record<string, unknown> & {
  status: NayaxCompletionDeliveryStatus | "already_sent";
};

type DeliverNayaxCompletionOnceInput = {
  deliver: () => Promise<boolean>;
  finish: (
    status: NayaxCompletionDeliveryStatus,
  ) => Promise<NayaxCompletionResult>;
  isDeliveryUncertain: (error: unknown) => boolean;
};

const fallbackResult = (
  status: NayaxCompletionDeliveryStatus,
): NayaxCompletionResult => ({
  status,
  transport: "gmail_thread",
  managerCcCount: 0,
  originalThread: true,
  operationApplied: false,
  managerCompletionNoticeSent: false,
});

export const deliverNayaxCompletionOnce = async ({
  deliver,
  finish,
  isDeliveryUncertain,
}: DeliverNayaxCompletionOnceInput): Promise<NayaxCompletionResult> => {
  let deliveryReturned = false;
  try {
    const usedOriginalGmailThread = await deliver();
    if (!usedOriginalGmailThread) {
      throw new Error("original_gmail_thread_required");
    }
    deliveryReturned = true;
    return await finish("sent");
  } catch (error) {
    const failureStatus = deliveryReturned || isDeliveryUncertain(error)
      ? "delivery_unknown"
      : "failed";
    try {
      return await finish(failureStatus);
    } catch {
      return fallbackResult(failureStatus);
    }
  }
};
