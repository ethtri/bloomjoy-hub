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

type DeliverPreparedNayaxCompletionOnceInput<T> =
  & Omit<
    DeliverNayaxCompletionOnceInput,
    "deliver"
  >
  & {
    load: () => Promise<T>;
    deliverLoaded: (loaded: T) => Promise<boolean>;
  };

type DeliverNayaxCompletionWithDefiniteRetryInput =
  & DeliverNayaxCompletionOnceInput
  & {
    prepareSameMessageRetry: () => Promise<boolean>;
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

export const deliverPreparedNayaxCompletionOnce = async <T>({
  load,
  deliverLoaded,
  finish,
  isDeliveryUncertain,
}: DeliverPreparedNayaxCompletionOnceInput<T>) =>
  await deliverNayaxCompletionOnce({
    deliver: async () => deliverLoaded(await load()),
    finish,
    isDeliveryUncertain,
  });

export const deliverNayaxCompletionWithDefiniteRetry = async ({
  deliver,
  finish,
  isDeliveryUncertain,
  prepareSameMessageRetry,
}: DeliverNayaxCompletionWithDefiniteRetryInput) => {
  const first = await deliverNayaxCompletionOnce({
    deliver,
    finish,
    isDeliveryUncertain,
  });
  if (first.status !== "failed") return first;

  try {
    if (!await prepareSameMessageRetry()) return first;
  } catch {
    return first;
  }

  return await deliverNayaxCompletionOnce({
    deliver,
    finish,
    isDeliveryUncertain,
  });
};
